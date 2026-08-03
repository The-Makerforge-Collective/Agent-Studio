"""
Agent Substrate — actor runtime (real, minimal implementation of the contract; §7.12).

This is NOT the upstream gVisor/microVM snapshot runtime. It is a real, working actor runtime
implementing the parts Agent Studio depends on, deployed as a pod. It realizes the PRD's
pod-per-session fallback (R7, §2-Q11): each session/actor is a real Kubernetes Pod in the agent's
namespace, addressable by (atespace, name), with a real lifecycle.

  - POST   /actors                    schedule an actor (create a session Pod)      (FR-12.3)
  - GET    /actors/{ns}/{name}         actor status (pod phase)
  - GET    /actors/{ns}/{name}/logs    session output (waits for completion)
  - DELETE /actors/{ns}/{name}         kill the actor (delete pod)                   (R2 kill switch)
  - GET    /healthz

Not implemented vs upstream: sub-second snapshot suspend/resume, gVisor/microVM kernel isolation,
warm WorkerPool multiplexing. Those are density/latency optimizations, not correctness — the actor
still runs isolated in its namespace (FR-12.8). Fail-soft to "skipped" when not in a cluster.
"""
from __future__ import annotations

import time
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

try:
    from kubernetes import client, config
    _HAVE_K8S = True
except Exception:  # pragma: no cover
    _HAVE_K8S = False

app = FastAPI(title="agent-substrate")


def _load() -> bool:
    # in-cluster only: from the pod we run against the cluster; local process cleanly skips.
    if not _HAVE_K8S:
        return False
    try:
        config.load_incluster_config()
        return True
    except Exception:
        return False


class ActorSpec(BaseModel):
    atespace: str
    name: str
    namespace: str                       # the agent's k8s namespace (isolation boundary)
    image: str
    command: list[str]
    env: dict[str, str] = {}
    cpu: str = "50m"
    memory: str = "64Mi"


def _pod_name(name: str) -> str:
    return f"actor-{name}"


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "service": "agent-substrate", "in_cluster": _load()}


@app.post("/actors")
def create_actor(spec: ActorSpec) -> dict[str, Any]:
    if not _load():
        return {"actor": f"{spec.atespace}/{spec.name}", "status": "skipped",
                "reason": "no in-cluster config (local mode)"}
    core = client.CoreV1Api()
    name = _pod_name(spec.name)
    pod = client.V1Pod(
        metadata=client.V1ObjectMeta(
            name=name, namespace=spec.namespace,
            labels={"substrate.dev/atespace": spec.atespace, "substrate.dev/actor": spec.name,
                    "app.kubernetes.io/managed-by": "agent-substrate"}),
        spec=client.V1PodSpec(
            restart_policy="Never",
            containers=[client.V1Container(
                name="actor", image=spec.image, command=spec.command,
                env=[client.V1EnvVar(name=k, value=v) for k, v in spec.env.items()],
                resources=client.V1ResourceRequirements(
                    requests={"cpu": spec.cpu, "memory": spec.memory}))]))
    try:
        core.read_namespaced_pod(name, spec.namespace)  # idempotent
    except client.ApiException as e:
        if e.status != 404:
            raise HTTPException(500, str(e))
        core.create_namespaced_pod(spec.namespace, pod)
    return {"actor": f"{spec.atespace}/{spec.name}", "pod": f"{spec.namespace}/{name}",
            "status": "scheduled"}


@app.get("/actors/{namespace}/{name}")
def actor_status(namespace: str, name: str) -> dict[str, Any]:
    if not _load():
        raise HTTPException(503, "no cluster")
    core = client.CoreV1Api()
    try:
        pod = core.read_namespaced_pod(_pod_name(name), namespace)
    except client.ApiException as e:
        raise HTTPException(404 if e.status == 404 else 500, str(e))
    return {"actor": name, "phase": pod.status.phase}


@app.get("/actors/{namespace}/{name}/logs")
def actor_logs(namespace: str, name: str, timeout: int = 30) -> dict[str, Any]:
    if not _load():
        raise HTTPException(503, "no cluster")
    core = client.CoreV1Api()
    pod = _pod_name(name)
    deadline = time.time() + timeout
    phase = "Pending"
    while time.time() < deadline:
        try:
            p = core.read_namespaced_pod(pod, namespace)
        except client.ApiException as e:
            raise HTTPException(404 if e.status == 404 else 500, str(e))
        phase = p.status.phase
        if phase in ("Succeeded", "Failed"):
            break
        time.sleep(1)
    logs = ""
    try:
        logs = core.read_namespaced_pod_log(pod, namespace)
    except client.ApiException:
        pass
    return {"actor": name, "phase": phase, "logs": logs}


@app.delete("/actors/{namespace}/{name}")
def kill_actor(namespace: str, name: str) -> dict[str, Any]:
    if not _load():
        raise HTTPException(503, "no cluster")
    core = client.CoreV1Api()
    try:
        core.delete_namespaced_pod(_pod_name(name), namespace)
    except client.ApiException as e:
        raise HTTPException(404 if e.status == 404 else 500, str(e))
    return {"actor": name, "status": "killed"}
