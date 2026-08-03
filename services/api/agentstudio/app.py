"""
Agent Studio — control-plane API (multi-tenant, enterprise).

Every resource is tenant-scoped (row-level isolation, FR-12.5); endpoints require a JWT and enforce
RBAC (viewer < editor < admin). A user in tenant A can never see or act on tenant B's resources.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from . import db, k8s, runtimeport
from .auth import (Principal, create_token, get_principal, hash_password,
                   require_role, verify_password)
from .compiler import NODE_CATALOG, Spec, compile_spec
from .executor import run_workflow

app = FastAPI(title="Agent Studio — Control Plane")


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


# ----------------------------- auth -----------------------------
class LoginBody(BaseModel):
    email: str
    password: str


@app.post("/api/v1/auth/login")
def login(body: LoginBody) -> dict[str, Any]:
    with db.session() as s:
        user = s.scalar(db.select(db.User).where(db.User.email == body.email))
        if not user or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, "invalid email or password")
        m = s.scalar(db.select(db.Membership).where(db.Membership.user_id == user.id))
        if not m:
            raise HTTPException(403, "user has no tenant membership")
        token = create_token(user.id, m.tenant_id, m.role, user.email)
        return {"token": token, "tenant_id": m.tenant_id, "role": m.role, "email": user.email}


@app.get("/api/v1/me")
def me(p: Principal = Depends(get_principal)) -> Principal:
    return p


class NewUser(BaseModel):
    email: str
    password: str
    role: str = "editor"


@app.post("/api/v1/admin/users")
def create_user(body: NewUser, p: Principal = Depends(require_role("admin"))) -> dict[str, Any]:
    """Admin adds a user to the caller's tenant (real user management)."""
    with db.session() as s:
        existing = s.scalar(db.select(db.User).where(db.User.email == body.email))
        if existing:
            user = existing
        else:
            user = db.User(email=body.email, password_hash=hash_password(body.password))
            s.add(user)
            s.flush()
        s.add(db.Membership(user_id=user.id, tenant_id=p.tenant_id, role=body.role))
        s.commit()
        return {"user_id": user.id, "email": user.email, "tenant_id": p.tenant_id, "role": body.role}


# ----------------------------- health / catalog -----------------------------
@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "agent-studio-control-plane",
            "db": db.DATABASE_URL.split("://", 1)[0], "in_cluster": k8s.in_cluster(),
            "multi_tenant": True}


@app.get("/api/v1/nodes")
def nodes(p: Principal = Depends(get_principal)) -> dict[str, Any]:
    return {"catalog": NODE_CATALOG}


# ----------------------------- workflows (tenant-scoped) -----------------------------
class CreateWorkflow(BaseModel):
    name: str
    spec: Spec


@app.post("/api/v1/workflows")
def create_workflow(body: CreateWorkflow, p: Principal = Depends(require_role("editor"))) -> dict[str, Any]:
    with db.session() as s:
        wf = db.Workflow(tenant_id=p.tenant_id, name=body.name,
                         spec=body.spec.model_dump(), created_by=p.email)
        s.add(wf)
        s.commit()
        return {"id": wf.id, "name": wf.name, "tenant_id": wf.tenant_id}


@app.get("/api/v1/workflows")
def list_workflows(p: Principal = Depends(get_principal)) -> list[dict[str, Any]]:
    with db.session() as s:
        rows = s.scalars(db.select(db.Workflow).where(db.Workflow.tenant_id == p.tenant_id)).all()
        return [{"id": w.id, "name": w.name} for w in rows]


def _owned_workflow(s, wid: str, p: Principal) -> "db.Workflow":
    w = s.get(db.Workflow, wid)
    if not w or w.tenant_id != p.tenant_id:      # cross-tenant access is a 404, not a 403 (no leak)
        raise HTTPException(404, "workflow not found")
    return w


@app.get("/api/v1/workflows/{wid}")
def get_workflow(wid: str, p: Principal = Depends(get_principal)) -> dict[str, Any]:
    with db.session() as s:
        w = _owned_workflow(s, wid, p)
        return {"id": w.id, "name": w.name, "spec": w.spec, "tenant_id": w.tenant_id}


@app.post("/api/v1/workflows/compile")
def compile_endpoint(spec: Spec, p: Principal = Depends(get_principal)) -> JSONResponse:
    result = compile_spec(spec)
    return JSONResponse(result, status_code=200 if result["ok"] else 422)


@app.post("/api/v1/workflows/{wid}/deploy")
def deploy_workflow(wid: str, p: Principal = Depends(require_role("editor"))) -> dict[str, Any]:
    with db.session() as s:
        w = _owned_workflow(s, wid, p)
        compiled = compile_spec(Spec(**w.spec))
        if not compiled["ok"]:
            raise HTTPException(422, {"msg": "spec does not compile", "errors": compiled["errors"]})
        recon = k8s.reconcile_agent_namespace(wid)
        dep = db.Deployment(tenant_id=p.tenant_id, workflow_id=wid,
                            namespace=recon["namespace"], status=recon["status"], detail=recon)
        s.add(dep)
        s.commit()
        return {"deployment_id": dep.id, "workflow": w.name, **recon}


@app.get("/api/v1/deployments")
def list_deployments(p: Principal = Depends(get_principal)) -> list[dict[str, Any]]:
    with db.session() as s:
        rows = s.scalars(db.select(db.Deployment).where(db.Deployment.tenant_id == p.tenant_id)).all()
        return [{"id": d.id, "workflow_id": d.workflow_id, "namespace": d.namespace,
                 "status": d.status} for d in rows]


@app.get("/api/v1/namespaces")
def namespaces(p: Principal = Depends(get_principal)) -> dict[str, Any]:
    return {"agent_namespaces": k8s.list_agent_namespaces()}


# ----------------------------- runs -----------------------------
class RunRequest(Spec):
    seed: dict[str, Any] = {}


def _has_cli(spec: Spec) -> bool:
    return any(n.type == "cli" for n in spec.nodes)


async def _run_stream(spec: Spec, seed: dict[str, Any], tenant_id: str):
    def sse(ev: dict) -> str:
        return f"event: {ev['event']}\ndata: {json.dumps({k: v for k, v in ev.items() if k != 'event'})}\n\n"

    with db.session() as s:
        run = db.Run(tenant_id=tenant_id)
        s.add(run)
        s.commit()
        run_id = run.id

    # bind the Substrate runtime + ensure the tenant's isolated run namespace when cli nodes are present
    runtime = runtimeport.bind()
    namespace = None
    if _has_cli(spec) and runtime is not None:
        recon = k8s.reconcile_agent_namespace(tenant_id)
        namespace = recon.get("namespace")
        yield sse({"event": "namespace", "run_id": run_id, "namespace": namespace,
                   "status": recon.get("status")})

    yield sse({"event": "run", "run_id": run_id, "status": "accepted"})
    starts: dict[str, tuple[float, str]] = {}
    seq = 0
    final_status = "completed"
    for ev in run_workflow(spec, seed, runtime=runtime, namespace=namespace):
        et = ev.get("event")
        if et == "node_start":
            starts[ev["node"]] = (time.time(), ev.get("type", ""))
        elif et == "node_end":
            nid = ev["node"]
            t0, ntype = starts.get(nid, (time.time(), ""))
            t1 = time.time()
            seq += 1
            with db.session() as s:                       # persist the span (FR-9.1)
                s.add(db.RunNode(run_id=run_id, tenant_id=tenant_id, seq=seq, node_id=nid,
                                 node_type=ntype, status=ev.get("status", "ok"),
                                 t_start=t0, t_end=t1, duration_ms=int((t1 - t0) * 1000)))
                s.commit()
            if ev.get("status") == "error":
                final_status = "failed"
        yield sse(ev)
        await asyncio.sleep(0)
    with db.session() as s:
        r = s.get(db.Run, run_id)
        if r:
            r.status = final_status
            s.commit()


@app.post("/api/v1/runs")
async def run_endpoint(req: RunRequest, p: Principal = Depends(require_role("editor"))) -> StreamingResponse:
    spec = Spec(nodes=req.nodes, edges=req.edges)
    return StreamingResponse(_run_stream(spec, req.seed, p.tenant_id), media_type="text/event-stream")


@app.get("/api/v1/runs")
def list_runs(p: Principal = Depends(get_principal)) -> list[dict[str, Any]]:
    with db.session() as s:
        rows = s.scalars(db.select(db.Run).where(db.Run.tenant_id == p.tenant_id)).all()
        return [{"id": r.id, "status": r.status, "started_at": r.started_at} for r in rows]


@app.get("/api/v1/runs/{run_id}/trace")
def run_trace(run_id: str, p: Principal = Depends(get_principal)) -> dict[str, Any]:
    """The run's span waterfall — per-node timing (FR-9.1), tenant-scoped."""
    with db.session() as s:
        r = s.get(db.Run, run_id)
        if not r or r.tenant_id != p.tenant_id:
            raise HTTPException(404, "run not found")
        spans = s.scalars(db.select(db.RunNode).where(db.RunNode.run_id == run_id)
                          .order_by(db.RunNode.seq)).all()
        total = sum(sp.duration_ms for sp in spans)
        return {"run_id": r.id, "status": r.status, "total_ms": total,
                "spans": [{"seq": sp.seq, "node": sp.node_id, "type": sp.node_type,
                           "status": sp.status, "duration_ms": sp.duration_ms} for sp in spans]}


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return INDEX_HTML


INDEX_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>Agent Studio</title>
<style>
 :root{--bg:#faf8f5;--fg:#2b2724;--mut:#a89a86;--card:#fff;--line:#e7dfd3;--accent:#9a5b2b;--ok:#2f7d4f;--err:#b23b3b}
 @media(prefers-color-scheme:dark){:root{--bg:#1c1a18;--fg:#e8e2da;--card:#252220;--line:#3a342e;--mut:#8a7d6c}}
 *{box-sizing:border-box} body{font-family:ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--fg);
  max-width:1000px;margin:4vh auto;padding:0 20px;line-height:1.45}
 h1{font-weight:650;letter-spacing:-.02em;margin:.2em 0} .pill{background:var(--line);border-radius:999px;padding:.1em .7em;font-size:.72em}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px} .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
 button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
 button.sec{background:transparent;color:var(--accent);border:1px solid var(--line)}
 pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;font-size:12.5px;max-height:240px}
 .mut{color:var(--mut);font-size:.85em} input{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin:2px}
 #who{font-size:.85em}
</style></head><body>
<h1>Agent&nbsp;Studio <span class="pill">enterprise · multi-tenant</span></h1>
<div class="card" id="loginCard"><b>Sign in</b> &nbsp;
 <input id="email" value="admin@agentstudio.dev"/><input id="pw" type="password" value="admin12345"/>
 <button onclick="login()">Login</button> <span id="who" class="mut"></span></div>
<div class="card"><b>Workflow</b> <input id="name" value="support-agent"/> <span class="mut">trigger → transform → router → end</span>
 <div><button class="sec" onclick="save()">Create</button>
  <button class="sec" onclick="deploy()">Deploy → namespace</button>
  <button class="sec" onclick="run()">Run</button>
  <button class="sec" onclick="listwf()">My workflows</button></div></div>
<div class="grid"><div class="card"><b>Result</b><pre id="out">— sign in first —</pre></div>
 <div class="card"><b>Live</b><pre id="stream">—</pre></div></div>
<p class="mut">Isolation: you only ever see your own tenant's workflows. RBAC: viewer&lt;editor&lt;admin.</p>
<script>
let TOKEN=null,WID=null;
const SPEC={seed:{x:4},nodes:[{id:"t",type:"trigger_api"},{id:"d",type:"transform",config:{expr:"x * 10",as:"y"}},
 {id:"r",type:"router",config:{when:"y > 30",true:"hi",false:"lo"}},{id:"hi",type:"transform",config:{expr:"'HIGH'",as:"band"}},
 {id:"lo",type:"transform",config:{expr:"'LOW'",as:"band"}},{id:"e",type:"end"}],
 edges:[{source:"t",target:"d"},{source:"d",target:"r"},{source:"r",target:"hi"},{source:"r",target:"lo"},{source:"hi",target:"e"},{source:"lo",target:"e"}]};
const H=()=>({"content-type":"application/json",...(TOKEN?{Authorization:"Bearer "+TOKEN}:{})});
const out=t=>document.getElementById("out").textContent=(typeof t=="string"?t:JSON.stringify(t,null,2));
async function login(){let r=await fetch("/api/v1/auth/login",{method:"POST",headers:H(),
 body:JSON.stringify({email:email.value,password:pw.value})});let j=await r.json();
 if(j.token){TOKEN=j.token;document.getElementById("who").textContent="✓ "+j.email+" · "+j.role+" · tenant "+j.tenant_id.slice(0,8);out({signed_in:j.email,role:j.role});}else out(j);}
async function save(){let r=await fetch("/api/v1/workflows",{method:"POST",headers:H(),body:JSON.stringify({name:name.value,spec:SPEC})});let j=await r.json();WID=j.id;out(j);}
async function deploy(){if(!WID)await save();let r=await fetch(`/api/v1/workflows/${WID}/deploy`,{method:"POST",headers:H()});out(await r.json());}
async function listwf(){let r=await fetch("/api/v1/workflows",{headers:H()});out(await r.json());}
async function run(){let r=await fetch("/api/v1/runs",{method:"POST",headers:H(),body:JSON.stringify(SPEC)});
 const rd=r.body.getReader(),dec=new TextDecoder();let buf="";for(;;){let{done,value}=await rd.read();if(done)break;buf+=dec.decode(value);document.getElementById("stream").textContent=buf;}}
</script></body></html>"""
