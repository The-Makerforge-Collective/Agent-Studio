"""
Agent Studio — control-plane API (multi-tenant, enterprise).

Every resource is tenant-scoped (row-level isolation, FR-12.5); endpoints require a JWT and enforce
RBAC (viewer < editor < admin). A user in tenant A can never see or act on tenant B's resources.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from . import db, k8s, knowledge as knowledge_mod, memory, runtimeport
from .auth import (Principal, create_token, get_principal, hash_password,
                   require_role, verify_password)
from .compiler import NODE_CATALOG, NODE_DOCS, Spec, compile_spec
from .executor import run_workflow

app = FastAPI(title="Agent Studio — Control Plane")


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


@app.on_event("startup")
async def _start_scheduler() -> None:
    if os.environ.get("SCHEDULER_ENABLED") == "1":
        asyncio.create_task(_scheduler_loop())


async def _scheduler_loop() -> None:
    while True:
        await asyncio.sleep(5)
        try:
            _tick(time.time())
        except Exception:  # pragma: no cover - never let the loop die
            pass


def _tick(now: float) -> list[str]:
    """Fire every due schedule once; advance next_fire_at. Returns fired schedule ids (FR-10.2)."""
    fired: list[str] = []
    with db.session() as s:
        due = s.scalars(db.select(db.Schedule)
                        .where(db.Schedule.enabled == True, db.Schedule.next_fire_at <= now)).all()  # noqa: E712
        for sch in due:
            w = s.get(db.Workflow, sch.workflow_id)
            if not w:
                sch.enabled = False
                continue
            status, _ = _collect_run(Spec(**w.spec), {}, sch.tenant_id)
            run = db.Run(tenant_id=sch.tenant_id, workflow_id=sch.workflow_id, status=status)
            s.add(run)
            s.flush()
            sch.last_run_id = run.id
            sch.next_fire_at = now + sch.interval_seconds
            fired.append(sch.id)
        s.commit()
    return fired


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


@app.get("/metrics", response_class=PlainTextResponse)
def metrics() -> str:
    """Prometheus-format metrics (observability, FR-9). Unauthenticated for scraping."""
    from collections import Counter
    with db.session() as s:
        runs = s.scalars(db.select(db.Run)).all()
        n_workflows = len(s.scalars(db.select(db.Workflow)).all())
        n_pending = len([a for a in s.scalars(db.select(db.ApprovalRequest)).all()
                         if a.state == "pending"])
    by_status = Counter(r.status for r in runs)
    lines = [
        "# HELP agent_studio_runs_total Total workflow runs.",
        "# TYPE agent_studio_runs_total counter",
        f"agent_studio_runs_total {len(runs)}",
        "# HELP agent_studio_runs_status Runs by terminal status.",
        "# TYPE agent_studio_runs_status gauge",
        *[f'agent_studio_runs_status{{status="{st}"}} {c}' for st, c in sorted(by_status.items())],
        "# HELP agent_studio_workflows_total Stored workflows.",
        "# TYPE agent_studio_workflows_total gauge",
        f"agent_studio_workflows_total {n_workflows}",
        "# HELP agent_studio_pending_approvals Runs paused awaiting approval.",
        "# TYPE agent_studio_pending_approvals gauge",
        f"agent_studio_pending_approvals {n_pending}",
        "# HELP agent_studio_node_types Node types in the catalog.",
        "# TYPE agent_studio_node_types gauge",
        f"agent_studio_node_types {len(NODE_CATALOG)}",
    ]
    return "\n".join(lines) + "\n"


@app.get("/api/v1/nodes")
def nodes(p: Principal = Depends(get_principal)) -> dict[str, Any]:
    return {"catalog": NODE_CATALOG}


@app.get("/api/v1/docs")
def self_docs() -> dict[str, Any]:
    """Self-documentation (FR-11.1) generated from the live system — can't drift from reality."""
    node_docs = [{"type": t, "description": NODE_DOCS.get(t, ""),
                  "inputs": NODE_CATALOG[t]["inputs"], "outputs": NODE_CATALOG[t]["outputs"]}
                 for t in NODE_CATALOG]
    routes = sorted({f"{list(r.methods - {'HEAD', 'OPTIONS'})[0]} {r.path}"
                     for r in app.routes if getattr(r, "methods", None) and r.path.startswith("/api/")})
    return {"service": "agent-studio", "nodes": node_docs,
            "deploy_surfaces": ["POST /api/v1/workflows/{id}/run (HTTP)",
                                "POST /api/v1/workflows/{id}/mcp (MCP server)"],
            "endpoints": routes, "node_count": len(node_docs)}


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


# ----------------------------- knowledge (RAG, tenant-scoped) -----------------------------
class IngestBody(BaseModel):
    source: str = "upload"
    text: str


@app.post("/api/v1/knowledge/sources")
def ingest_knowledge(body: IngestBody, p: Principal = Depends(require_role("editor"))) -> dict[str, Any]:
    n = knowledge_mod.PgKnowledge().ingest(p.tenant_id, body.source, body.text)
    return {"ingested_chunks": n, "source": body.source}


@app.get("/api/v1/knowledge/query")
def query_knowledge(q: str, k: int = 3, p: Principal = Depends(get_principal)) -> dict[str, Any]:
    return {"query": q, "results": knowledge_mod.PgKnowledge().search(p.tenant_id, q, k)}


# ----------------------------- runs -----------------------------
class RunRequest(Spec):
    seed: dict[str, Any] = {}


def _has_cli(spec: Spec) -> bool:
    return any(n.type == "cli" for n in spec.nodes)


def _make_sub_runner(tenant_id, mem, know, runtime, namespace, depth=0):
    def run(wid: str, child_seed: dict[str, Any]) -> dict[str, Any]:
        if depth >= 5:
            raise RuntimeError("subworkflow recursion depth limit (5) exceeded")
        with db.session() as s:
            w = s.get(db.Workflow, wid)
            if not w or w.tenant_id != tenant_id:
                raise RuntimeError(f"subworkflow {wid} not found")
            child_spec = Spec(**w.spec)
        final: dict[str, Any] = {}
        for cev in run_workflow(child_spec, child_seed, runtime=runtime, namespace=namespace,
                                memory=mem, tenant_id=tenant_id, knowledge=know,
                                sub_runner=_make_sub_runner(tenant_id, mem, know, runtime, namespace, depth + 1)):
            if cev.get("event") == "done":
                final = cev.get("state", {})
            elif cev.get("event") == "error":
                raise RuntimeError(f"subworkflow {wid} failed: {cev.get('errors')}")
        return final
    return run


def _collect_run(spec: Spec, seed: dict[str, Any], tenant_id: str) -> tuple[str, dict[str, Any]]:
    """Run a workflow to completion (non-streaming) and return (status, final_state)."""
    runtime = runtimeport.bind()
    namespace = None
    if _has_cli(spec) and runtime is not None:
        namespace = k8s.reconcile_agent_namespace(tenant_id).get("namespace")
    mem, know = memory.PgMemory(), knowledge_mod.PgKnowledge()
    final: dict[str, Any] = {}
    status = "completed"
    for ev in run_workflow(spec, seed, runtime=runtime, namespace=namespace, memory=mem,
                           tenant_id=tenant_id, knowledge=know,
                           sub_runner=_make_sub_runner(tenant_id, mem, know, runtime, namespace, 0)):
        if ev.get("event") == "done":
            final = ev.get("state", {})
        elif ev.get("event") == "error":
            status = "failed"
    return status, final


def _persist_pause(ev: dict, spec: Spec, tenant_id: str, run_id: str) -> str:
    """Persist a durable HITL pause and mark the run paused (§5.7). Returns the request id."""
    with db.session() as s:
        ar = db.ApprovalRequest(tenant_id=tenant_id, run_id=run_id, node_id=ev["node"],
                                context={"spec": spec.model_dump(), "reached": ev["reached"],
                                         "executed": ev["executed"], "state": ev["state"],
                                         "node": ev["node"]})
        s.add(ar)
        s.flush()
        r = s.get(db.Run, run_id)
        if r:
            r.status = "paused"
        s.commit()
        return ar.id


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
    mem = memory.PgMemory()
    know = knowledge_mod.PgKnowledge()
    sub_runner = _make_sub_runner(tenant_id, mem, know, runtime, namespace, 0)
    starts: dict[str, tuple[float, str]] = {}
    seq = 0
    final_status = "completed"
    for ev in run_workflow(spec, seed, runtime=runtime, namespace=namespace,
                           memory=mem, tenant_id=tenant_id, knowledge=know,
                           sub_runner=sub_runner):
        et = ev.get("event")
        if et == "paused":
            req_id = _persist_pause(ev, spec, tenant_id, run_id)
            yield sse({"event": "paused", "run_id": run_id, "request_id": req_id,
                       "node": ev["node"], "message": "awaiting approval"})
            return                                        # run is paused durably
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


class InvokeBody(BaseModel):
    seed: dict[str, Any] = {}


@app.post("/api/v1/workflows/{wid}/run")
async def run_deployed_workflow(wid: str, body: InvokeBody,
                                p: Principal = Depends(require_role("editor"))) -> StreamingResponse:
    """Deploy surface (FR-10.1): invoke a stored workflow by id — the persisted spec is executed."""
    with db.session() as s:
        w = _owned_workflow(s, wid, p)
        spec = Spec(**w.spec)
    return StreamingResponse(_run_stream(spec, body.seed, p.tenant_id), media_type="text/event-stream")


@app.get("/api/v1/workflows/{wid}/widget", response_class=HTMLResponse)
def workflow_widget(wid: str) -> str:
    """Deploy surface (FR-10.1): a self-contained embeddable chat widget for a workflow."""
    return WIDGET_HTML.replace("__WID__", wid)


@app.post("/api/v1/workflows/{wid}/mcp")
def mcp_server(wid: str, req: dict, p: Principal = Depends(require_role("editor"))) -> dict[str, Any]:
    """Deploy surface (FR-6.4/13.2): expose a workflow as an MCP tool over JSON-RPC 2.0."""
    with db.session() as s:
        w = _owned_workflow(s, wid, p)
        name, spec = w.name, Spec(**w.spec)
    rid, method, params = req.get("id"), req.get("method"), req.get("params") or {}

    def ok(result):
        return {"jsonrpc": "2.0", "id": rid, "result": result}

    if method == "initialize":
        return ok({"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                   "serverInfo": {"name": f"agent-studio:{name}", "version": "0.1"}})
    if method == "tools/list":
        return ok({"tools": [{"name": name, "description": f"Run the '{name}' workflow",
                              "inputSchema": {"type": "object",
                                              "properties": {"seed": {"type": "object"}}}}]})
    if method == "tools/call":
        args = params.get("arguments") or {}
        seed = args.get("seed", args)
        status, final = _collect_run(spec, seed, p.tenant_id)
        return ok({"content": [{"type": "text", "text": json.dumps(final)}],
                   "isError": status == "failed"})
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"method not found: {method}"}}


class ScheduleBody(BaseModel):
    workflow_id: str
    interval_seconds: int = 60


@app.post("/api/v1/schedules")
def create_schedule(body: ScheduleBody, p: Principal = Depends(require_role("editor"))) -> dict[str, Any]:
    with db.session() as s:
        _owned_workflow(s, body.workflow_id, p)          # tenant-scoped ownership check
        sch = db.Schedule(tenant_id=p.tenant_id, workflow_id=body.workflow_id,
                          interval_seconds=max(1, body.interval_seconds), next_fire_at=time.time())
        s.add(sch)
        s.commit()
        return {"id": sch.id, "workflow_id": sch.workflow_id, "interval_seconds": sch.interval_seconds}


@app.get("/api/v1/schedules")
def list_schedules(p: Principal = Depends(get_principal)) -> list[dict[str, Any]]:
    with db.session() as s:
        rows = s.scalars(db.select(db.Schedule).where(db.Schedule.tenant_id == p.tenant_id)).all()
        return [{"id": r.id, "workflow_id": r.workflow_id, "interval_seconds": r.interval_seconds,
                 "enabled": r.enabled, "last_run_id": r.last_run_id} for r in rows]


@app.get("/api/v1/runs")
def list_runs(p: Principal = Depends(get_principal)) -> list[dict[str, Any]]:
    with db.session() as s:
        rows = s.scalars(db.select(db.Run).where(db.Run.tenant_id == p.tenant_id)).all()
        return [{"id": r.id, "status": r.status, "started_at": r.started_at} for r in rows]


class ApproveBody(BaseModel):
    request_id: str
    decision: str = "approve"           # approve | reject


@app.get("/api/v1/runs/{run_id}/approvals")
def list_pending_approvals(run_id: str, p: Principal = Depends(get_principal)) -> list[dict[str, Any]]:
    with db.session() as s:
        rows = s.scalars(db.select(db.ApprovalRequest).where(
            db.ApprovalRequest.run_id == run_id, db.ApprovalRequest.tenant_id == p.tenant_id)).all()
        return [{"request_id": a.id, "node": a.node_id, "state": a.state} for a in rows]


@app.post("/api/v1/runs/{run_id}/approve")
def approve_run(run_id: str, body: ApproveBody,
                p: Principal = Depends(require_role("editor"))) -> dict[str, Any]:
    """Approve/reject a paused run (§5.7). Approve resumes from the pause with no re-execution."""
    with db.session() as s:
        ar = s.get(db.ApprovalRequest, body.request_id)
        if not ar or ar.tenant_id != p.tenant_id or ar.run_id != run_id:
            raise HTTPException(404, "approval request not found")
        if ar.state != "pending":
            raise HTTPException(409, f"already {ar.state}")
        ctx = ar.context
        if body.decision == "reject":
            ar.state = "rejected"
            r = s.get(db.Run, run_id)
            if r:
                r.status = "rejected"
            s.commit()
            return {"decision": "rejected", "run_id": run_id, "status": "rejected"}
        ar.state = "approved"
        s.commit()

    # resume from the pause point (no re-execution of already-run nodes)
    spec = Spec(**ctx["spec"])
    resume = {"reached": ctx["reached"], "executed": ctx["executed"],
              "state": ctx["state"], "approved": [ctx["node"]]}
    runtime = runtimeport.bind()
    namespace = None
    if _has_cli(spec) and runtime is not None:
        namespace = k8s.reconcile_agent_namespace(p.tenant_id).get("namespace")
    mem, know = memory.PgMemory(), knowledge_mod.PgKnowledge()
    status, final = "completed", {}
    for ev in run_workflow(spec, resume=resume, runtime=runtime, namespace=namespace, memory=mem,
                           tenant_id=p.tenant_id, knowledge=know,
                           sub_runner=_make_sub_runner(p.tenant_id, mem, know, runtime, namespace, 0)):
        if ev.get("event") == "done":
            final = ev.get("state", {})
        elif ev.get("event") == "error":
            status = "failed"
        elif ev.get("event") == "paused":            # another gate downstream → new pending request
            req2 = _persist_pause(ev, spec, p.tenant_id, run_id)
            return {"decision": "approved", "run_id": run_id, "status": "paused", "request_id": req2}
    with db.session() as s:
        r = s.get(db.Run, run_id)
        if r:
            r.status = status
        s.commit()
    return {"decision": "approved", "run_id": run_id, "status": status, "state": final}


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


WIDGET_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>Agent Studio widget</title>
<style>
 body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:420px;margin:0;padding:12px;background:#faf8f5;color:#2b2724}
 @media(prefers-color-scheme:dark){body{background:#1c1a18;color:#e8e2da}}
 #log{min-height:140px;border:1px solid #e7dfd3;border-radius:10px;padding:10px;font-size:14px;white-space:pre-wrap}
 input{width:100%;padding:8px;border:1px solid #e7dfd3;border-radius:8px;margin:4px 0;background:transparent;color:inherit}
 button{background:#9a5b2b;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
 .mut{color:#a89a86;font-size:12px}
</style></head><body>
<div class="mut">Agent Studio · workflow <code>__WID__</code></div>
<input id="tok" placeholder="API token (Bearer)"/>
<div id="log">Ask something…</div>
<input id="msg" placeholder="Type a message and press Enter" onkeydown="if(event.key==='Enter')send()"/>
<button onclick="send()">Send</button>
<script>
const WID="__WID__";
async function send(){
 const msg=document.getElementById('msg').value, tok=document.getElementById('tok').value;
 document.getElementById('log').textContent="…";
 const r=await fetch(`/api/v1/workflows/${WID}/run`,{method:'POST',
   headers:{'content-type':'application/json','Authorization':'Bearer '+tok},
   body:JSON.stringify({seed:{input:msg}})});
 const rd=r.body.getReader(),dec=new TextDecoder();let buf="",last="";
 for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value);
   const lines=buf.split('\\n').filter(l=>l.startsWith('data:')&&l.includes('completed'));
   if(lines.length)last=lines[lines.length-1].slice(5);}
 document.getElementById('log').textContent=last||buf;
}
</script></body></html>"""


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
