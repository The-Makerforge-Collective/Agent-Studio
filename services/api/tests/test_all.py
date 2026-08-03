"""Real tests — no mocks. Exercises the evaluator, execution engine, compiler, and HTTP API."""
import time
import json
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")

import pytest
from fastapi.testclient import TestClient

from agentstudio.compiler import Spec, compile_spec
from agentstudio.executor import run_workflow
from agentstudio.expr import ExprError, evaluate


# ---------- safe expression evaluator ----------
def test_expr_arithmetic_and_compare():
    assert evaluate("x + 2 * 3", {"x": 1}) == 7
    assert evaluate("x > 5 and y < 2", {"x": 10, "y": 1}) is True
    assert evaluate("n in vals", {"n": 3, "vals": [1, 2, 3]}) is True


def test_expr_rejects_unsafe():
    with pytest.raises(ExprError):
        evaluate("__import__('os').system('echo hi')", {})
    with pytest.raises(ExprError):
        evaluate("x.__class__", {"x": 1})
    with pytest.raises(ExprError):
        evaluate("open('/etc/passwd')", {})


# ---------- compiler ----------
def _spec(nodes, edges):
    return Spec(nodes=[{"id": i, "type": t, **({"config": c} if c else {})}
                       for i, t, c in nodes],
                edges=[{"source": s, "target": d} for s, d in edges])


def test_compile_valid_dag():
    r = compile_spec(_spec([("t", "trigger_api", None), ("e", "end", None)], [("t", "e")]))
    assert r["ok"] and r["layers"] == [["t"], ["e"]]


def test_compile_detects_cycle():
    r = compile_spec(_spec([("a", "agent", None), ("b", "agent", None)],
                           [("a", "b"), ("b", "a")]))
    assert not r["ok"] and any("cycle" in e for e in r["errors"])


def test_compile_isolated_node_is_a_root():
    # an isolated node has indegree 0 → it's a valid additional root, reachable, compiles ok
    r = compile_spec(_spec([("t", "trigger_api", None), ("e", "end", None), ("x", "agent", None)],
                           [("t", "e")]))
    assert r["ok"] and r["unreachable"] == []


# ---------- execution engine (real state threading) ----------
def test_run_transform_threads_state():
    spec = _spec(
        [("t", "trigger_api", {"seed": {"x": 4}}),
         ("d", "transform", {"expr": "x * 10", "as": "y"}),
         ("e", "end", None)],
        [("t", "d"), ("d", "e")])
    events = list(run_workflow(spec))
    done = [e for e in events if e["event"] == "done"][0]
    assert done["state"]["y"] == 40


def test_run_router_activates_one_branch():
    spec = _spec(
        [("t", "trigger_api", {"seed": {"score": 9}}),
         ("r", "router", {"when": "score > 5", "true": "hi", "false": "lo"}),
         ("hi", "transform", {"expr": "'HIGH'", "as": "band"}),
         ("lo", "transform", {"expr": "'LOW'", "as": "band"}),
         ("e", "end", None)],
        [("t", "r"), ("r", "hi"), ("r", "lo"), ("hi", "e"), ("lo", "e")])
    events = list(run_workflow(spec))
    skipped = {e["node"] for e in events if e["event"] == "node_skip"}
    done = [e for e in events if e["event"] == "done"][0]
    assert "lo" in skipped and "hi" not in skipped
    assert done["state"]["band"] == "HIGH"


def test_cli_without_runtime_is_honest_not_mock():
    spec = _spec([("t", "trigger_api", None), ("c", "cli", {"command": ["echo", "hi"]})],
                 [("t", "c")])
    events = list(run_workflow(spec))  # no runtime bound
    msg = [e for e in events if e["event"] == "messages" and e["node"] == "c"][0]
    assert msg["result"]["ran"] is False  # did not fabricate output


def test_cli_executes_via_bound_runtime():
    # a real (in-process) runtime double that satisfies the port — exercises the wiring, no network
    class LocalRuntime:
        def run_actor(self, namespace, atespace, image, command, name=None, timeout=45):
            import subprocess
            out = subprocess.run(command, capture_output=True, text=True).stdout
            return {"phase": "Succeeded", "logs": out, "actor": "local"}
    spec = _spec([("t", "trigger_api", None), ("c", "cli", {"command": ["echo", "from-actor"], "as": "o"})],
                 [("t", "c")])
    done = [e for e in run_workflow(spec, runtime=LocalRuntime(), namespace="ns")
            if e["event"] == "done"][0]
    assert "from-actor" in done["state"]["o"]


def test_quality_gate_passes_and_continues():
    spec = _spec([("t", "trigger_api", {"seed": {"score": 90}}),
                  ("g", "quality_gate", {"checks": [{"name": "score>=80", "expr": "score >= 80"}]}),
                  ("e", "end", None)],
                 [("t", "g"), ("g", "e")])
    events = list(run_workflow(spec))
    assert any(e["event"] == "done" for e in events)                 # gate passed → reached end
    assert not any(e["event"] == "error" for e in events)


def test_quality_gate_blocks_run_on_failure():
    spec = _spec([("t", "trigger_api", {"seed": {"score": 40}}),
                  ("g", "quality_gate", {"checks": [{"name": "score>=80", "expr": "score >= 80"}]}),
                  ("e", "end", None)],
                 [("t", "g"), ("g", "e")])
    events = list(run_workflow(spec))
    assert any(e["event"] == "error" for e in events)                # gate failed → run blocked
    assert not any(e.get("node") == "e" and e["event"] == "node_start" for e in events)  # end never ran


def test_memory_write_then_read_across_runs():
    # a real in-process store (dict-backed) implementing the memory port — persists across runs
    class DictMemory:
        def __init__(self): self.d = {}
        def put(self, tenant, key, value): self.d[(tenant, key)] = value
        def get(self, tenant, key): return self.d.get((tenant, key))
    mem = DictMemory()
    # run 1: compute and persist to memory
    w = _spec([("t", "trigger_api", {"seed": {"x": 5}}),
               ("d", "transform", {"expr": "x * 3", "as": "y"}),
               ("m", "memory_write", {"key": "last_y", "from": "y"})],
              [("t", "d"), ("d", "m")])
    list(run_workflow(w, memory=mem, tenant_id="acme"))
    # run 2: read it back
    r = _spec([("t", "trigger_api", None),
               ("m", "memory_read", {"key": "last_y", "as": "recalled"}),
               ("e", "end", None)],
              [("t", "m"), ("m", "e")])
    done = [e for e in run_workflow(r, memory=mem, tenant_id="acme") if e["event"] == "done"][0]
    assert done["state"]["recalled"] == 15


def test_memory_is_tenant_scoped():
    class DictMemory:
        def __init__(self): self.d = {}
        def put(self, tenant, key, value): self.d[(tenant, key)] = value
        def get(self, tenant, key): return self.d.get((tenant, key))
    mem = DictMemory()
    w = _spec([("t", "trigger_api", {"seed": {"v": 1}}), ("m", "memory_write", {"key": "k", "from": "v"})],
              [("t", "m")])
    list(run_workflow(w, memory=mem, tenant_id="acme"))
    r = _spec([("t", "trigger_api", None), ("m", "memory_read", {"key": "k", "as": "got"}), ("e", "end", None)],
              [("t", "m"), ("m", "e")])
    done = [e for e in run_workflow(r, memory=mem, tenant_id="globex") if e["event"] == "done"][0]
    assert done["state"]["got"] is None  # other tenant sees nothing


def test_subworkflow_runs_child_and_merges_state():
    # child workflow doubles x into y; a real sub_runner runs it via run_workflow
    child = _spec([("t", "trigger_api", None),
                   ("d", "transform", {"expr": "x * 2", "as": "y"}), ("e", "end", None)],
                  [("t", "d"), ("d", "e")])

    def sub_runner(wid, seed):
        assert wid == "child-1"
        return [e for e in run_workflow(child, seed) if e["event"] == "done"][0]["state"]

    parent = _spec([("t", "trigger_api", {"seed": {"x": 6}}),
                    ("s", "subworkflow", {"workflow_id": "child-1"}), ("e", "end", None)],
                   [("t", "s"), ("s", "e")])
    done = [e for e in run_workflow(parent, sub_runner=sub_runner) if e["event"] == "done"][0]
    assert done["state"]["y"] == 12          # child's output merged into parent state


def test_parallel_fanout_runs_branches_concurrently():
    # two child workflows compute different things; a real sub_runner runs each via run_workflow
    doubler = _spec([("t", "trigger_api", None), ("d", "transform", {"expr": "x * 2", "as": "r"}), ("e", "end", None)],
                    [("t", "d"), ("d", "e")])
    squarer = _spec([("t", "trigger_api", None), ("d", "transform", {"expr": "x * x", "as": "r"}), ("e", "end", None)],
                    [("t", "d"), ("d", "e")])
    kids = {"double": doubler, "square": squarer}

    def sub_runner(wid, seed):
        return [e for e in run_workflow(kids[wid], seed) if e["event"] == "done"][0]["state"]

    parent = _spec([("t", "trigger_api", {"seed": {"x": 5}}),
                    ("p", "parallel_fanout", {"branches": ["double", "square"], "merge_as": "outs"}),
                    ("e", "end", None)],
                   [("t", "p"), ("p", "e")])
    done = [e for e in run_workflow(parent, sub_runner=sub_runner) if e["event"] == "done"][0]
    rs = sorted(o["r"] for o in done["state"]["outs"])
    assert rs == [10, 25]                     # both branches ran (5*2=10, 5*5=25)


def test_subworkflow_honest_without_runner():
    parent = _spec([("t", "trigger_api", None), ("s", "subworkflow", {"workflow_id": "x"})],
                   [("t", "s")])
    events = list(run_workflow(parent))       # no runner bound
    msg = [e for e in events if e["event"] == "messages" and e["node"] == "s"][0]
    assert msg["result"]["ran"] is False


def test_guardrail_node_blocks_run_on_match():
    spec = _spec([("t", "trigger_api", {"seed": {"msg": "my password is hunter2"}}),
                  ("g", "guardrail", {"input_from": "msg", "blocked": [r"\bpassword\b"]}),
                  ("e", "end", None)],
                 [("t", "g"), ("g", "e")])
    events = list(run_workflow(spec))
    assert any(e["event"] == "error" for e in events)
    assert not any(e.get("node") == "e" and e["event"] == "node_start" for e in events)


def test_guardrail_node_redacts():
    spec = _spec([("t", "trigger_api", {"seed": {"msg": "call me at 555-1234 now"}}),
                  ("g", "guardrail", {"input_from": "msg", "on_match": "redact",
                                      "blocked": [r"\d{3}-\d{4}"], "as": "clean"}),
                  ("e", "end", None)],
                 [("t", "g"), ("g", "e")])
    done = [e for e in run_workflow(spec) if e["event"] == "done"][0]
    assert "[REDACTED]" in done["state"]["clean"] and "555-1234" not in done["state"]["clean"]


def test_classifier_picks_best_label():
    spec = _spec([("t", "trigger_api", {"seed": {"msg": "my invoice payment failed and I want a refund"}}),
                  ("c", "classifier", {"input_from": "msg", "as": "topic",
                                       "labels": {"billing": ["invoice", "payment", "refund"],
                                                  "tech": ["error", "bug", "crash"]}}),
                  ("e", "end", None)],
                 [("t", "c"), ("c", "e")])
    done = [e for e in run_workflow(spec) if e["event"] == "done"][0]
    assert done["state"]["topic"] == "billing"


def test_classifier_falls_back_to_default():
    spec = _spec([("t", "trigger_api", {"seed": {"msg": "hello there"}}),
                  ("c", "classifier", {"input_from": "msg", "as": "topic", "default": "other",
                                       "labels": {"billing": ["invoice"], "tech": ["bug"]}}),
                  ("e", "end", None)],
                 [("t", "c"), ("c", "e")])
    done = [e for e in run_workflow(spec) if e["event"] == "done"][0]
    assert done["state"]["topic"] == "other"


def test_run_agent_without_credentials_is_honest_not_mock():
    spec = _spec([("t", "trigger_api", None), ("a", "agent", {"prompt": "hi"})], [("t", "a")])
    events = list(run_workflow(spec))
    msg = [e for e in events if e["event"] == "messages" and e["node"] == "a"][0]
    assert msg["result"]["credentialed"] is False  # real client, no key — not a fake answer


# ---------- HTTP API ----------
@pytest.fixture(scope="module")
def client():
    from agentstudio.app import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def auth(client):
    tok = client.post("/api/v1/auth/login",
                      json={"email": "admin@agentstudio.dev", "password": "admin12345"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def test_api_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_self_docs_covers_every_node(client):
    from agentstudio.compiler import NODE_CATALOG
    docs = client.get("/api/v1/docs").json()
    documented = {n["type"] for n in docs["nodes"]}
    assert documented == set(NODE_CATALOG)                 # every node type is documented
    assert all(n["description"] for n in docs["nodes"])    # and has a description
    assert any("/mcp" in s for s in docs["deploy_surfaces"])


def test_api_compile_rejects_cycle(client, auth):
    r = client.post("/api/v1/workflows/compile", headers=auth,
                    json={"nodes": [{"id": "a", "type": "agent"}, {"id": "b", "type": "agent"}],
                          "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}]})
    assert r.status_code == 422


def test_api_create_and_run(client, auth):
    wf = client.post("/api/v1/workflows", headers=auth, json={
        "name": "t",
        "spec": {"nodes": [{"id": "t", "type": "trigger_api", "config": {"seed": {"x": 2}}},
                           {"id": "d", "type": "transform", "config": {"expr": "x + 5", "as": "y"}},
                           {"id": "e", "type": "end"}],
                 "edges": [{"source": "t", "target": "d"}, {"source": "d", "target": "e"}]}}).json()
    assert "id" in wf
    r = client.post("/api/v1/runs", headers=auth, json={
        "nodes": [{"id": "t", "type": "trigger_api", "config": {"seed": {"x": 2}}},
                  {"id": "d", "type": "transform", "config": {"expr": "x + 5", "as": "y"}},
                  {"id": "e", "type": "end"}],
        "edges": [{"source": "t", "target": "d"}, {"source": "d", "target": "e"}]})
    assert '"y": 7' in r.text and "done" in r.text


def test_scheduler_tick_fires_due_workflow(client, auth):
    wf = client.post("/api/v1/workflows", headers=auth, json={
        "name": "scheduled",
        "spec": {"nodes": [{"id": "t", "type": "trigger_api"}, {"id": "e", "type": "end"}],
                 "edges": [{"source": "t", "target": "e"}]}}).json()
    sch = client.post("/api/v1/schedules", headers=auth,
                      json={"workflow_id": wf["id"], "interval_seconds": 60}).json()
    before = len(client.get("/api/v1/runs", headers=auth).json())
    from agentstudio.app import _tick
    fired = _tick(time.time() + 1)                        # advance clock past next_fire_at
    assert sch["id"] in fired
    after = len(client.get("/api/v1/runs", headers=auth).json())
    assert after == before + 1                            # the scheduled run was recorded
    # firing again immediately does nothing (next_fire_at advanced)
    assert sch["id"] not in _tick(time.time() + 1)


def test_deploy_surface_run_stored_workflow_by_id(client, auth):
    wf = client.post("/api/v1/workflows", headers=auth, json={
        "name": "invokable",
        "spec": {"nodes": [{"id": "t", "type": "trigger_api"},
                           {"id": "d", "type": "transform", "config": {"expr": "x * 2", "as": "y"}},
                           {"id": "e", "type": "end"}],
                 "edges": [{"source": "t", "target": "d"}, {"source": "d", "target": "e"}]}}).json()
    # invoke by id with a seed — the stored spec runs, no inline spec needed
    r = client.post(f"/api/v1/workflows/{wf['id']}/run", headers=auth, json={"seed": {"x": 21}})
    assert '"y": 42' in r.text and "done" in r.text


def test_widget_surface_serves_embeddable_html(client, auth):
    wf = client.post("/api/v1/workflows", headers=auth, json={
        "name": "w", "spec": {"nodes": [{"id": "t", "type": "trigger_api"}], "edges": []}}).json()
    r = client.get(f"/api/v1/workflows/{wf['id']}/widget")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert wf["id"] in r.text and "/run" in r.text        # widget targets this workflow's run surface


def test_mcp_server_surface(client, auth):
    wf = client.post("/api/v1/workflows", headers=auth, json={
        "name": "doubler",
        "spec": {"nodes": [{"id": "t", "type": "trigger_api"},
                           {"id": "d", "type": "transform", "config": {"expr": "x * 2", "as": "y"}},
                           {"id": "e", "type": "end"}],
                 "edges": [{"source": "t", "target": "d"}, {"source": "d", "target": "e"}]}}).json()
    mcp = f"/api/v1/workflows/{wf['id']}/mcp"
    # initialize
    init = client.post(mcp, headers=auth, json={"jsonrpc": "2.0", "id": 1, "method": "initialize"}).json()
    assert init["result"]["protocolVersion"] == "2024-11-05"
    # tools/list exposes the workflow as a tool
    tl = client.post(mcp, headers=auth, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()
    assert tl["result"]["tools"][0]["name"] == "doubler"
    # tools/call runs it
    call = client.post(mcp, headers=auth, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                                "params": {"name": "doubler", "arguments": {"seed": {"x": 20}}}}).json()
    assert '"y": 40' in call["result"]["content"][0]["text"]


def test_run_trace_span_waterfall(client, auth):
    r = client.post("/api/v1/runs", headers=auth, json={
        "nodes": [{"id": "t", "type": "trigger_api"}, {"id": "e", "type": "end"}],
        "edges": [{"source": "t", "target": "e"}]})
    run_id = [json.loads(line.split("data:", 1)[1]) for line in r.text.splitlines()
              if line.startswith("data:") and '"run_id"' in line][0]["run_id"]
    trace = client.get(f"/api/v1/runs/{run_id}/trace", headers=auth).json()
    assert trace["status"] == "completed"
    assert [s["node"] for s in trace["spans"]] == ["t", "e"]          # ordered spans
    assert all("duration_ms" in s for s in trace["spans"])            # per-node timing recorded


def test_run_trace_is_tenant_scoped(client, auth):
    # another tenant cannot read this tenant's run trace
    from agentstudio import db
    from agentstudio.auth import create_token
    other = {"Authorization": f"Bearer {create_token('u2', 'other-tenant', 'admin', 'x@y.z')}"}
    r = client.post("/api/v1/runs", headers=auth, json={
        "nodes": [{"id": "t", "type": "trigger_api"}], "edges": []})
    run_id = [json.loads(line.split("data:", 1)[1]) for line in r.text.splitlines()
              if line.startswith("data:") and '"run_id"' in line][0]["run_id"]
    assert client.get(f"/api/v1/runs/{run_id}/trace", headers=other).status_code == 404
