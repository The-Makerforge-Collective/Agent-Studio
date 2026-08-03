"""Real substrate tests — no mocks. Local mode skips cleanly; spec validation is enforced."""
import pytest
from fastapi.testclient import TestClient

from substrate.app import app, ActorSpec

client = TestClient(app)

SPEC = {"atespace": "ts1", "name": "sess1", "namespace": "agent-x",
        "image": "busybox", "command": ["echo", "hi"]}


def test_healthz_local_not_in_cluster():
    j = client.get("/healthz").json()
    assert j["status"] == "ok" and j["in_cluster"] is False


def test_create_actor_skips_without_cluster():
    j = client.post("/actors", json=SPEC).json()
    assert j["status"] == "skipped"


def test_actorspec_requires_fields():
    with pytest.raises(Exception):
        ActorSpec(atespace="a", name="b")  # missing namespace/image/command


def test_status_without_cluster_is_503():
    assert client.get("/actors/agent-x/sess1").status_code == 503
