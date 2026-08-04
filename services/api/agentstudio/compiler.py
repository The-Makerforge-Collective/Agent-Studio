"""Spec -> DAG validation + topological layering (FR-1.2, FR-2.2 at toy scale)."""
from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from pydantic import BaseModel

NODE_CATALOG: dict[str, dict[str, Any]] = {
    "trigger_api": {
        "inputs": [], "outputs": ["out"],
        "label": "API Trigger", "category": "Triggers", "icon": "zap",
        "description": "HTTP endpoint that starts the workflow",
        "config_schema": {
            "method": {"type": "enum", "options": ["GET", "POST", "PUT"], "default": "POST", "description": "HTTP method"},
            "path": {"type": "string", "default": "/trigger", "description": "Endpoint path"},
        },
    },
    "agent": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Agent", "category": "Core", "icon": "bot",
        "description": "LLM agent with a system prompt",
        "config_schema": {
            "model": {"type": "enum", "options": ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"], "default": "gpt-4o", "description": "Model to use"},
            "prompt": {"type": "text", "default": "", "description": "System prompt for the agent"},
            "temperature": {"type": "number", "default": 0.7, "min": 0, "max": 2, "step": 0.1, "description": "Sampling temperature"},
        },
    },
    "transform": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Transform", "category": "Core", "icon": "settings",
        "description": "Transform data with an expression",
        "config_schema": {
            "expr": {"type": "text", "default": "", "description": "Expression to evaluate"},
            "as": {"type": "string", "default": "result", "description": "Output variable name"},
        },
    },
    "cli": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "CLI", "category": "Core", "icon": "terminal",
        "description": "Run a shell command in a sandboxed container",
        "config_schema": {
            "command": {"type": "text", "default": "", "description": "Shell command to execute"},
            "timeout": {"type": "number", "default": 30, "min": 1, "max": 300, "description": "Timeout in seconds"},
        },
    },
    "tool_call": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Tool Call", "category": "Core", "icon": "wrench",
        "description": "Call an external tool or API",
        "config_schema": {
            "method": {"type": "enum", "options": ["GET", "POST", "PUT", "DELETE"], "default": "POST", "description": "HTTP method"},
            "url": {"type": "string", "default": "", "description": "Endpoint URL"},
            "body": {"type": "json", "default": {}, "description": "Request body (JSON)"},
            "project": {"type": "string", "default": "", "description": "JSONPath to extract from response"},
            "as": {"type": "string", "default": "result", "description": "Output variable name"},
        },
    },
    "router": {
        "inputs": ["in"], "outputs": ["a", "b"],
        "label": "Router", "category": "Control Flow", "icon": "git-branch",
        "description": "Conditional branch (true → a, false → b)",
        "config_schema": {
            "when": {"type": "text", "default": "", "description": "Boolean expression to evaluate"},
        },
    },
    "classifier": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Classifier", "category": "Control Flow", "icon": "tag",
        "description": "Classify input into categories",
        "config_schema": {
            "labels": {"type": "json", "default": [], "description": "Classification labels (JSON array)"},
            "prompt": {"type": "text", "default": "", "description": "Classification prompt"},
            "as": {"type": "string", "default": "label", "description": "Output variable name"},
        },
    },
    "parallel_fanout": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Parallel Fanout", "category": "Control Flow", "icon": "git-merge",
        "description": "Fan out to parallel branches",
        "config_schema": {
            "branches": {"type": "json", "default": [], "description": "Workflow IDs to run in parallel"},
            "merge_as": {"type": "string", "default": "results", "description": "Output variable name for merged results"},
        },
    },
    "subworkflow": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Subworkflow", "category": "Control Flow", "icon": "layers",
        "description": "Run another workflow as a step",
        "config_schema": {
            "workflow_id": {"type": "string", "default": "", "description": "ID of workflow to run"},
        },
    },
    "memory_write": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Memory Write", "category": "Knowledge", "icon": "edit",
        "description": "Write to memory store",
        "config_schema": {
            "key": {"type": "string", "default": "", "description": "Memory key"},
            "from": {"type": "string", "default": "", "description": "State variable to persist"},
        },
    },
    "memory_read": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Memory Read", "category": "Knowledge", "icon": "book-open",
        "description": "Read from memory store",
        "config_schema": {
            "key": {"type": "string", "default": "", "description": "Memory key to read"},
            "as": {"type": "string", "default": "", "description": "State variable to store result"},
        },
    },
    "retrieval": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Retrieval", "category": "Knowledge", "icon": "search",
        "description": "Retrieve from knowledge base",
        "config_schema": {
            "collection": {"type": "string", "default": "", "description": "Knowledge collection name"},
            "query": {"type": "text", "default": "", "description": "Search query (or state variable with query_from)"},
            "top_k": {"type": "number", "default": 5, "min": 1, "max": 50, "description": "Number of results"},
            "as": {"type": "string", "default": "docs", "description": "Output variable name"},
        },
    },
    "quality_gate": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Quality Gate", "category": "Review/Safety", "icon": "check-circle",
        "description": "Assert quality conditions",
        "config_schema": {
            "checks": {"type": "json", "default": [], "description": "Predicate expressions to check (JSON array)"},
            "threshold": {"type": "number", "default": 0.8, "min": 0, "max": 1, "step": 0.05, "description": "Pass threshold (0-1)"},
        },
    },
    "guardrail": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Guardrail", "category": "Review/Safety", "icon": "shield",
        "description": "Block or redact on regex match",
        "config_schema": {
            "input_from": {"type": "string", "default": "", "description": "State variable to scan"},
            "blocked": {"type": "json", "default": [], "description": "Regex patterns to block (JSON array)"},
            "action": {"type": "enum", "options": ["block", "redact"], "default": "block", "description": "Action on match"},
        },
    },
    "approval": {
        "inputs": ["in"], "outputs": ["out"],
        "label": "Approval", "category": "Review/Safety", "icon": "user-check",
        "description": "Pause for human approval",
        "config_schema": {
            "message": {"type": "text", "default": "", "description": "Message shown to approver"},
            "approvers": {"type": "json", "default": [], "description": "Approver emails (JSON array)"},
        },
    },
    "end": {
        "inputs": ["in"], "outputs": [],
        "label": "End", "category": "Control Flow", "icon": "square",
        "description": "Terminal node; collects final state",
        "config_schema": {},
    },
}

NODE_CONFIG_SCHEMAS: dict[str, dict] = {
    "trigger_api": {
        "type": "object",
        "properties": {
            "method": {"type": "string", "default": "POST"},
            "path": {"type": "string", "default": "/trigger"},
        },
    },
    "agent": {
        "type": "object",
        "properties": {
            "model": {"type": "string", "default": "gpt-4o"},
            "prompt": {"type": "string", "default": ""},
            "temperature": {"type": "number", "default": 0.7},
        },
    },
    "transform": {
        "type": "object",
        "properties": {
            "expr": {"type": "string", "default": ""},
            "as": {"type": "string", "default": "result"},
        },
    },
    "cli": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "default": ""},
            "timeout": {"type": "integer", "default": 30},
        },
    },
    "tool_call": {
        "type": "object",
        "properties": {
            "tool": {"type": "string", "default": ""},
            "args": {"type": "object", "default": {}},
        },
    },
    "router": {
        "type": "object",
        "properties": {
            "when": {"type": "string", "default": ""},
        },
    },
    "classifier": {
        "type": "object",
        "properties": {
            "labels": {"type": "array", "items": {"type": "string"}, "default": []},
            "prompt": {"type": "string", "default": ""},
        },
    },
    "parallel_fanout": {
        "type": "object",
        "properties": {
            "branches": {"type": "integer", "default": 2},
        },
    },
    "subworkflow": {
        "type": "object",
        "properties": {
            "workflow_id": {"type": "string", "default": ""},
        },
    },
    "memory_write": {
        "type": "object",
        "properties": {
            "key": {"type": "string", "default": ""},
            "value": {"type": "string", "default": ""},
        },
    },
    "memory_read": {
        "type": "object",
        "properties": {
            "key": {"type": "string", "default": ""},
        },
    },
    "retrieval": {
        "type": "object",
        "properties": {
            "collection": {"type": "string", "default": ""},
            "query": {"type": "string", "default": ""},
            "top_k": {"type": "integer", "default": 5},
        },
    },
    "quality_gate": {
        "type": "object",
        "properties": {
            "check": {"type": "string", "default": ""},
            "threshold": {"type": "number", "default": 0.8},
        },
    },
    "guardrail": {
        "type": "object",
        "properties": {
            "pattern": {"type": "string", "default": ""},
            "action": {"type": "string", "default": "block"},
        },
    },
    "approval": {
        "type": "object",
        "properties": {
            "approvers": {"type": "array", "items": {"type": "string"}, "default": []},
            "message": {"type": "string", "default": ""},
        },
    },
    "end": {
        "type": "object",
        "properties": {},
    },
}

NODE_DOCS = {
    "trigger_api": "Entry node; seeds initial state from config.seed.",
    "agent": "Calls a model through the gateway (config.prompt); no provider keys in the app.",
    "transform": "Computes a value via the safe expression evaluator (config.expr → config.as).",
    "cli": "Runs config.command as a Substrate actor pod in the tenant's namespace.",
    "quality_gate": "Hard gate: every config.checks predicate must pass or the run fails.",
    "memory_write": "Persists state[config.from] to tenant memory under config.key.",
    "memory_read": "Recalls tenant memory config.key into state[config.as].",
    "retrieval": "Keyword search over tenant knowledge (config.query/query_from → config.as).",
    "subworkflow": "Runs another stored workflow (config.workflow_id), merging its output state.",
    "parallel_fanout": "Runs config.branches (workflow ids) concurrently, collecting results into config.merge_as.",
    "classifier": "Multi-way keyword classification into config.labels → config.as.",
    "tool_call": "Calls a REST endpoint (config.method/url/body); projects config.project into config.as.",
    "guardrail": "Scans config.input_from for config.blocked regexes; fails the run or redacts on match.",
    "approval": "Human-in-the-loop gate: pauses the run until an approve/reject decision (§5.7).",
    "router": "Boolean branch on config.when; activates config.true or config.false target.",
    "end": "Terminal node; collects final state.",
}


class Node(BaseModel):
    id: str
    type: str
    config: dict[str, Any] = {}


class Edge(BaseModel):
    source: str
    target: str


class Spec(BaseModel):
    nodes: list[Node]
    edges: list[Edge] = []


def compile_spec(spec: Spec) -> dict[str, Any]:
    errors: list[str] = []
    ids = [n.id for n in spec.nodes]
    idset = set(ids)

    if len(ids) != len(idset):
        errors.append("duplicate node ids")
    for n in spec.nodes:
        if n.type not in NODE_CATALOG:
            errors.append(f"unknown node type '{n.type}' on node '{n.id}'")
    for e in spec.edges:
        if e.source not in idset:
            errors.append(f"edge source '{e.source}' is not a node")
        if e.target not in idset:
            errors.append(f"edge target '{e.target}' is not a node")

    adj: dict[str, list[str]] = defaultdict(list)
    indeg: dict[str, int] = {i: 0 for i in idset}
    for e in spec.edges:
        if e.source in idset and e.target in idset:
            adj[e.source].append(e.target)
            indeg[e.target] += 1

    layers: list[list[str]] = []
    working = dict(indeg)
    frontier = deque(sorted(i for i in idset if working[i] == 0))
    seen = 0
    while frontier:
        layer = sorted(frontier)
        frontier = deque()
        for nid in layer:
            seen += 1
            for nxt in adj[nid]:
                working[nxt] -= 1
                if working[nxt] == 0:
                    frontier.append(nxt)
        layers.append(layer)
    if seen != len(idset):
        errors.append("cycle detected (graph is not a DAG)")

    roots = [i for i in idset if indeg[i] == 0]
    reached: set[str] = set()
    dq = deque(roots)
    while dq:
        cur = dq.popleft()
        if cur in reached:
            continue
        reached.add(cur)
        dq.extend(adj[cur])
    unreachable = sorted(idset - reached)
    if unreachable:
        errors.append(f"unreachable nodes: {', '.join(unreachable)}")

    return {"ok": not errors, "errors": errors, "layers": layers, "unreachable": unreachable}
