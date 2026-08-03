"""Namespace-per-agent reconciler (FR-12.1 at real, minimal scale).

On deploy, provisions a dedicated Kubernetes namespace for the agent with a default-deny
NetworkPolicy and a ResourceQuota — reconcile-don't-create (idempotent). This is the PRD's
core isolation boundary, actually created in the cluster (not the full Go kubebuilder operator,
but the same reconcile semantics driven from the control plane).

Degrades gracefully when not running in a cluster (local process): returns status "skipped".
"""
from __future__ import annotations

from typing import Any

try:
    from kubernetes import client, config
    _HAVE_K8S = True
except Exception:  # pragma: no cover
    _HAVE_K8S = False


def _load() -> bool:
    """Load in-cluster config only. We intentionally do NOT fall back to a local kubeconfig:
    from the pod we want in-cluster; from a local process we want to cleanly skip rather than
    dial a possibly-stale kubeconfig context."""
    if not _HAVE_K8S:
        return False
    try:
        config.load_incluster_config()
        return True
    except Exception:
        return False


def reconcile_agent_namespace(agent_id: str) -> dict[str, Any]:
    ns = f"agent-{agent_id[:12]}"
    if not _load():
        return {"namespace": ns, "status": "skipped", "reason": "no in-cluster config (local mode)",
                "created": []}
    try:
        return _reconcile(agent_id, ns)
    except Exception as e:  # fail-soft: never 500 the API on a cluster hiccup
        return {"namespace": ns, "status": "error", "reason": str(e)[:200], "created": []}


def _reconcile(agent_id: str, ns: str) -> dict[str, Any]:
    core = client.CoreV1Api()
    net = client.NetworkingV1Api()
    created: list[str] = []
    labels = {"agent-studio.dev/agent": agent_id[:12], "app.kubernetes.io/managed-by": "agent-studio"}

    # 1) Namespace (idempotent)
    try:
        core.read_namespace(ns)
    except client.ApiException as e:
        if e.status != 404:
            raise
        core.create_namespace(client.V1Namespace(
            metadata=client.V1ObjectMeta(name=ns, labels=labels)))
        created.append(f"namespace/{ns}")

    # 2) ResourceQuota (FR-12.1)
    quota = client.V1ResourceQuota(
        metadata=client.V1ObjectMeta(name="agent-quota", namespace=ns, labels=labels),
        spec=client.V1ResourceQuotaSpec(hard={"pods": "10", "requests.cpu": "2",
                                              "requests.memory": "2Gi"}))
    try:
        core.read_namespaced_resource_quota("agent-quota", ns)
    except client.ApiException as e:
        if e.status != 404:
            raise
        core.create_namespaced_resource_quota(ns, quota)
        created.append(f"resourcequota/{ns}/agent-quota")

    # 3) default-deny NetworkPolicy (FR-12.1: default-deny egress boundary)
    netpol = client.V1NetworkPolicy(
        metadata=client.V1ObjectMeta(name="default-deny", namespace=ns, labels=labels),
        spec=client.V1NetworkPolicySpec(
            pod_selector=client.V1LabelSelector(),
            policy_types=["Ingress", "Egress"]))
    try:
        net.read_namespaced_network_policy("default-deny", ns)
    except client.ApiException as e:
        if e.status != 404:
            raise
        net.create_namespaced_network_policy(ns, netpol)
        created.append(f"networkpolicy/{ns}/default-deny")

    return {"namespace": ns, "status": "ready", "created": created}


def list_agent_namespaces() -> list[str]:
    if not _load():
        return []
    try:
        core = client.CoreV1Api()
        return [n.metadata.name for n in
                core.list_namespace(label_selector="app.kubernetes.io/managed-by=agent-studio").items]
    except Exception:
        return []


def in_cluster() -> bool:
    return _load()
