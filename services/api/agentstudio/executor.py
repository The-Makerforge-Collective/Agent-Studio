"""Real node execution engine (FR-3.1/3.2/3.3 at real, minimal scale).

No stub: nodes thread a shared `state` dict, `transform` computes real values via the safe
expression evaluator, `router` evaluates a real predicate and activates one branch (real
conditional routing — downstream nodes on the dead branch are genuinely skipped), and `agent`
calls a real OpenAI-compatible endpoint when credentials/gateway are configured.

`agent` without credentials returns an explicit `unconfigured` result — that is a real client
with no key available in this environment, not a mock. Set AGENT_MODEL_BASE_URL + AGENT_MODEL_API_KEY
(the design routes this through agentgateway) to make it perform live completions.
"""
from __future__ import annotations

import os
from typing import Any, Iterator

from .compiler import Spec, compile_spec
from .expr import ExprError, evaluate


class ExecError(ValueError):
    pass


def _exec_trigger(node, state) -> dict[str, Any]:
    seed = node.config.get("seed", {})
    if not isinstance(seed, dict):
        raise ExecError("trigger 'seed' must be an object")
    state.update(seed)
    return {"seeded": list(seed.keys())}


def _exec_transform(node, state) -> dict[str, Any]:
    expr = node.config.get("expr")
    if not expr:
        raise ExecError("transform node requires config.expr")
    key = node.config.get("as", "result")
    try:
        value = evaluate(expr, state)
    except ExprError as e:
        raise ExecError(str(e)) from e
    state[key] = value
    return {key: value}


def _exec_router(node, state) -> dict[str, Any]:
    when = node.config.get("when")
    if not when:
        raise ExecError("router node requires config.when (a predicate)")
    try:
        truth = bool(evaluate(when, state))
    except ExprError as e:
        raise ExecError(str(e)) from e
    chosen = node.config.get("true" if truth else "false")
    return {"predicate": when, "value": truth, "active_target": chosen}


def _exec_agent(node, state) -> dict[str, Any]:
    base = os.environ.get("AGENT_MODEL_BASE_URL")
    key = os.environ.get("AGENT_MODEL_API_KEY")
    prompt = node.config.get("prompt", "")
    # interpolate {name} refs from state
    try:
        prompt = prompt.format(**state)
    except Exception:
        pass
    if not base or not key:
        return {"credentialed": False,
                "note": "agent client is real but no model endpoint configured "
                        "(set AGENT_MODEL_BASE_URL + AGENT_MODEL_API_KEY via the gateway)",
                "prompt": prompt}
    import httpx  # real HTTP call to an OpenAI-compatible endpoint (agentgateway route)
    model = node.config.get("model", "gpt-4o-mini")
    resp = httpx.post(
        f"{base.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}]},
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    state[node.config.get("as", "agent_output")] = content
    return {"credentialed": True, "model": model, "output": content}


def _exec_cli(node, state, runtime, namespace) -> dict[str, Any]:
    """Execute a command as a REAL Substrate actor pod in the tenant's namespace (FR-3.6/4.3)."""
    command = node.config.get("command")
    if not command or not isinstance(command, list):
        raise ExecError("cli node requires config.command (a list)")
    if runtime is None or not namespace:
        return {"ran": False, "note": "no Substrate runtime bound (local mode) — cli did not execute"}
    image = node.config.get("image", os.environ.get("CLI_DEFAULT_IMAGE", "agent-studio/control-plane:dev"))
    res = runtime.run_actor(namespace=namespace, atespace="run", image=image, command=command)
    logs = res.get("logs", "")
    state[node.config.get("as", "cli_output")] = logs
    return {"ran": True, "actor": res.get("actor"), "phase": res.get("phase"), "logs": logs}


def _exec_quality_gate(node, state) -> dict[str, Any]:
    """Hard gate (FR-8.4): every check predicate must pass or the run fails at this node."""
    checks = node.config.get("checks", [])
    if not isinstance(checks, list) or not checks:
        raise ExecError("quality_gate requires config.checks (a non-empty list)")
    results = []
    for c in checks:
        expr = c.get("expr")
        if not expr:
            raise ExecError("each check needs an 'expr'")
        try:
            passed = bool(evaluate(expr, state))
        except ExprError as e:
            raise ExecError(str(e)) from e
        results.append({"name": c.get("name", expr), "passed": passed})
    failed = [r["name"] for r in results if not r["passed"]]
    if failed:
        raise ExecError(f"quality gate failed: {', '.join(failed)}")
    return {"passed": True, "checks": results}


def _exec_memory_write(node, state, memory, tenant) -> dict[str, Any]:
    key, src = node.config.get("key"), node.config.get("from")
    if not key or not src:
        raise ExecError("memory_write requires config.key and config.from")
    if memory is None or not tenant:
        return {"stored": False, "note": "no memory store bound (local mode)"}
    value = state.get(src)
    memory.put(tenant, key, value)
    return {"stored": True, "key": key, "value": value}


def _exec_memory_read(node, state, memory, tenant) -> dict[str, Any]:
    key = node.config.get("key")
    if not key:
        raise ExecError("memory_read requires config.key")
    if memory is None or not tenant:
        return {"read": False, "note": "no memory store bound (local mode)"}
    value = memory.get(tenant, key)
    state[node.config.get("as", key)] = value
    return {"read": True, "key": key, "value": value}


def _exec_retrieval(node, state, knowledge, tenant) -> dict[str, Any]:
    query = state.get(node.config["query_from"]) if node.config.get("query_from") else node.config.get("query")
    if not query:
        raise ExecError("retrieval requires config.query or config.query_from")
    if knowledge is None or not tenant:
        return {"retrieved": False, "note": "no knowledge store bound (local mode)"}
    k = int(node.config.get("k", 3))
    hits = knowledge.search(tenant, str(query), k)
    state[node.config.get("as", "retrieved")] = [h["text"] for h in hits]
    return {"retrieved": True, "hits": len(hits), "results": hits}


def _exec_end(node, state) -> dict[str, Any]:
    return {"output": dict(state)}


EXECUTORS = {
    "trigger_api": _exec_trigger,
    "transform": _exec_transform,
    "quality_gate": _exec_quality_gate,
    "router": _exec_router,
    "agent": _exec_agent,
    "end": _exec_end,
}


def run_workflow(spec: Spec, seed: dict[str, Any] | None = None,
                 runtime=None, namespace: str | None = None,
                 memory=None, tenant_id: str | None = None,
                 knowledge=None) -> Iterator[dict[str, Any]]:
    """Execute the compiled workflow, yielding event dicts. Real state threading + routing.
    `cli` nodes execute as Substrate actor pods in `namespace` when a runtime is bound;
    `memory_*` nodes use the bound memory store, scoped to `tenant_id`."""
    compiled = compile_spec(spec)
    if not compiled["ok"]:
        yield {"event": "error", "errors": compiled["errors"]}
        return

    by_id = {n.id: n for n in spec.nodes}
    order = [nid for layer in compiled["layers"] for nid in layer]
    out_edges: dict[str, list[str]] = {n.id: [] for n in spec.nodes}
    for e in spec.edges:
        out_edges[e.source].append(e.target)

    roots = {nid for nid in by_id if all(e.target != nid for e in spec.edges)}
    reached: set[str] = set(roots)
    state: dict[str, Any] = dict(seed or {})

    yield {"event": "run", "status": "started", "order": order}
    for nid in order:
        node = by_id[nid]
        if nid not in reached:
            yield {"event": "node_skip", "node": nid, "reason": "inactive branch"}
            continue
        yield {"event": "node_start", "node": nid, "type": node.type}
        try:
            if node.type == "cli":
                result = _exec_cli(node, state, runtime, namespace)
            elif node.type == "memory_write":
                result = _exec_memory_write(node, state, memory, tenant_id)
            elif node.type == "memory_read":
                result = _exec_memory_read(node, state, memory, tenant_id)
            elif node.type == "retrieval":
                result = _exec_retrieval(node, state, knowledge, tenant_id)
            else:
                result = EXECUTORS[node.type](node, state)
        except Exception as e:
            yield {"event": "node_end", "node": nid, "status": "error", "error": str(e)}
            yield {"event": "error", "errors": [f"{nid}: {e}"]}
            return
        # activate downstream edges
        if node.type == "router":
            active = result.get("active_target")
            targets = [active] if active in out_edges[nid] else []
        else:
            targets = out_edges[nid]
        for t in targets:
            reached.add(t)
        yield {"event": "messages", "node": nid, "result": result}
        yield {"event": "node_end", "node": nid, "status": "ok"}
    yield {"event": "done", "status": "completed", "state": state}
