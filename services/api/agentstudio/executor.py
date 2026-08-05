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


def _exec_classifier(node, state) -> dict[str, Any]:
    """Multi-way content classification by keyword overlap (deterministic, no model)."""
    text = state.get(node.config["input_from"]) if node.config.get("input_from") else node.config.get("input", "")
    labels = node.config.get("labels")
    if not isinstance(labels, dict) or not labels:
        raise ExecError("classifier requires config.labels ({label: [keywords]})")
    low = str(text).lower()
    scores = {label: sum(1 for kw in kws if str(kw).lower() in low) for label, kws in labels.items()}
    best = max(scores, key=lambda k: scores[k])
    chosen = best if scores[best] > 0 else node.config.get("default", "unknown")
    state[node.config.get("as", "label")] = chosen
    return {"label": chosen, "scores": scores}


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


def _exec_agent(node, state, provider=None) -> dict[str, Any]:
    base = os.environ.get("AGENT_MODEL_BASE_URL")
    key = os.environ.get("AGENT_MODEL_API_KEY")
    ptype = "openai"
    if provider:
        base = provider.get("base_url") or base
        key = provider.get("api_key") or key
        ptype = provider.get("provider_type", "openai")
    prompt = node.config.get("prompt", "")
    try:
        prompt = prompt.format(**state)
    except Exception:
        pass
    if not base or not key:
        return {"credentialed": False,
                "note": "agent client is real but no model endpoint configured "
                        "(set AGENT_MODEL_BASE_URL + AGENT_MODEL_API_KEY via the gateway)",
                "prompt": prompt}
    import httpx
    model = node.config.get("model", "gpt-4o-mini" if ptype != "anthropic" else "claude-sonnet-4-20250514")
    if ptype == "anthropic":
        resp = httpx.post(
            f"{base.rstrip('/')}/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": model, "max_tokens": 1024,
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=60,
        )
        resp.raise_for_status()
        content = resp.json()["content"][0]["text"]
    else:
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


def _exec_subworkflow(node, state, sub_runner) -> dict[str, Any]:
    """Run another stored workflow as a step (§5), merging its output state back."""
    wid = node.config.get("workflow_id")
    if not wid:
        raise ExecError("subworkflow requires config.workflow_id")
    if sub_runner is None:
        return {"ran": False, "note": "no subworkflow runner bound (local mode)"}
    child_state = sub_runner(wid, dict(state))
    out_as = node.config.get("output_as")
    if out_as:
        state[out_as] = child_state
    else:
        state.update(child_state)
    return {"ran": True, "workflow_id": wid, "output_keys": list(child_state.keys())}


def _interp(v, state):
    if isinstance(v, str):
        try:
            return v.format(**state)
        except Exception:
            return v
    if isinstance(v, dict):
        return {k: _interp(x, state) for k, x in v.items()}
    return v


def _project(data, path):
    for part in path.split("."):
        if isinstance(data, list) and part.lstrip("-").isdigit():
            data = data[int(part)]
        elif isinstance(data, dict):
            data = data.get(part)
        else:
            return None
    return data


def _egress_blocked(url: str) -> str | None:
    """SSRF/egress guard (FR-5.5): block loopback/link-local (metadata) unless allowlisted."""
    import ipaddress
    import socket
    from urllib.parse import urlparse
    host = urlparse(url).hostname or ""
    allow = {h.strip() for h in os.environ.get("TOOL_ALLOW_HOSTS", "").split(",") if h.strip()}
    if host in allow:
        return None
    if os.environ.get("TOOL_EGRESS_GUARD", "1") != "1":
        return None
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(host))
    except Exception:
        return None                        # unresolvable → let the request fail naturally
    if ip.is_loopback or ip.is_link_local:
        return f"egress blocked: {host} -> {ip} (loopback/link-local)"
    return None


def _exec_tool_call(node, state) -> dict[str, Any]:
    """Call a REST endpoint and thread the (optionally projected) response into state (FR-6.1)."""
    url = node.config.get("url")
    if not url:
        raise ExecError("tool_call requires config.url")
    import httpx
    method = node.config.get("method", "GET").upper()
    url = _interp(url, state)
    blocked = _egress_blocked(url)
    if blocked:
        raise ExecError(blocked)
    headers = _interp(node.config.get("headers", {}), state)
    body = _interp(node.config.get("body"), state) if node.config.get("body") is not None else None
    resp = httpx.request(method, url, headers=headers,
                         json=body if body is not None else None, timeout=30)
    try:
        data = resp.json()
    except Exception:
        data = resp.text
    proj = node.config.get("project")
    value = _project(data, proj) if proj and isinstance(data, (dict, list)) else data
    state[node.config.get("as", "tool_result")] = value
    return {"status": resp.status_code, "projected": value if proj else "(full body)"}


def _exec_parallel(node, state, sub_runner) -> dict[str, Any]:
    """Run config.branches (workflow ids) CONCURRENTLY, each on a copy of state (FR-3.2)."""
    branches = node.config.get("branches")
    if not isinstance(branches, list) or not branches:
        raise ExecError("parallel_fanout requires config.branches (a non-empty list)")
    if sub_runner is None:
        return {"ran": False, "note": "no subworkflow runner bound (local mode)"}
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(8, len(branches))) as ex:
        results = list(ex.map(lambda wid: sub_runner(wid, dict(state)), branches))
    state[node.config.get("merge_as", "results")] = results
    return {"ran": True, "branches": len(branches), "results": results}


def _exec_guardrail(node, state) -> dict[str, Any]:
    """Content guardrail (§9 Safety): block the run or redact when config.blocked regexes match."""
    import re
    src = node.config.get("input_from")
    if not src:
        raise ExecError("guardrail requires config.input_from")
    patterns = node.config.get("blocked", [])
    text = str(state.get(src, ""))
    matched = [p for p in patterns if re.search(p, text, re.I)]
    if not matched:
        return {"matched": [], "action": "pass"}
    if node.config.get("on_match", "fail") == "redact":
        for p in patterns:
            text = re.sub(p, "[REDACTED]", text, flags=re.I)
        state[node.config.get("as", src)] = text
        return {"matched": matched, "action": "redacted"}
    raise ExecError(f"guardrail blocked: matched {matched}")


def _exec_end(node, state) -> dict[str, Any]:
    return {"output": dict(state)}


EXECUTORS = {
    "trigger_api": _exec_trigger,
    "transform": _exec_transform,
    "quality_gate": _exec_quality_gate,
    "classifier": _exec_classifier,
    "tool_call": _exec_tool_call,
    "guardrail": _exec_guardrail,
    "router": _exec_router,
    "agent": _exec_agent,
    "end": _exec_end,
}


def run_workflow(spec: Spec, seed: dict[str, Any] | None = None,
                 runtime=None, namespace: str | None = None,
                 memory=None, tenant_id: str | None = None,
                 knowledge=None, sub_runner=None, resume=None,
                 provider=None) -> Iterator[dict[str, Any]]:
    """Execute the compiled workflow, yielding event dicts. Real state threading + routing.
    `cli` nodes execute as Substrate actor pods; `memory_*`/`retrieval` use the bound stores.
    An `approval` node pauses the run (yields `paused` + resume context) until approved; passing
    `resume={reached,executed,state,approved}` continues from the pause with NO re-execution."""
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
    if resume:
        reached = set(resume["reached"])
        executed = set(resume["executed"])
        state = dict(resume["state"])
        approved = set(resume.get("approved", []))
    else:
        reached, executed, approved = set(roots), set(), set()
        state = dict(seed or {})

    yield {"event": "run", "status": "started", "order": order}
    for nid in order:
        node = by_id[nid]
        if nid not in reached:
            yield {"event": "node_skip", "node": nid, "reason": "inactive branch"}
            continue
        if nid in executed:
            continue                        # already ran before the pause — don't re-execute
        if node.type == "approval" and nid not in approved:
            # durable pause (§5.7): stop and hand the resume context to the caller
            yield {"event": "paused", "node": nid, "reached": sorted(reached),
                   "executed": sorted(executed), "state": state}
            return
        yield {"event": "node_start", "node": nid, "type": node.type}
        try:
            if node.type == "approval":
                result = {"approved": True, "by": approved and "human" or "auto"}
            elif node.type == "cli":
                result = _exec_cli(node, state, runtime, namespace)
            elif node.type == "memory_write":
                result = _exec_memory_write(node, state, memory, tenant_id)
            elif node.type == "memory_read":
                result = _exec_memory_read(node, state, memory, tenant_id)
            elif node.type == "retrieval":
                result = _exec_retrieval(node, state, knowledge, tenant_id)
            elif node.type == "subworkflow":
                result = _exec_subworkflow(node, state, sub_runner)
            elif node.type == "parallel_fanout":
                result = _exec_parallel(node, state, sub_runner)
            elif node.type == "agent":
                result = _exec_agent(node, state, provider=provider)
            else:
                result = EXECUTORS[node.type](node, state)
        except Exception as e:
            on_error = node.config.get("on_error")
            if on_error == "skip":
                yield {"event": "node_end", "node": nid, "status": "skipped", "error": str(e)}
                targets = out_edges[nid]
                for t in targets:
                    reached.add(t)
                executed.add(nid)
                continue
            if on_error == "fallback":
                fb = node.config.get("fallback_value", "")
                state[node.config.get("as", "result")] = fb
                result = {"fallback": True, "value": fb, "original_error": str(e)}
                yield {"event": "messages", "node": nid, "result": result}
                yield {"event": "node_end", "node": nid, "status": "fallback"}
                targets = out_edges[nid]
                for t in targets:
                    reached.add(t)
                executed.add(nid)
                continue
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
        executed.add(nid)
        yield {"event": "messages", "node": nid, "result": result}
        yield {"event": "node_end", "node": nid, "status": "ok"}
    yield {"event": "done", "status": "completed", "state": state}
