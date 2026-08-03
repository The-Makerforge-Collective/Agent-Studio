"""Real gateway tests — no mocks. Auth, budget enforcement, and honest no-upstream behavior."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./gwtest.db"
os.environ["GATEWAY_KEYS"] = "good-key:1000,broke-key:0"
os.environ["GATEWAY_BLOCKED_PATTERNS"] = r"\bpassword\b,ssn"
os.environ.pop("UPSTREAM_BASE_URL", None)
os.environ.pop("UPSTREAM_API_KEY", None)

import pytest
from fastapi.testclient import TestClient

from gateway.app import app

BODY = {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
    if os.path.exists("gwtest.db"):
        os.remove("gwtest.db")


def test_healthz(client):
    j = client.get("/healthz").json()
    assert j["status"] == "ok" and j["upstream_configured"] is False


def test_rejects_missing_token(client):
    assert client.post("/v1/chat/completions", json=BODY).status_code == 401


def test_rejects_invalid_key(client):
    r = client.post("/v1/chat/completions", json=BODY, headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_budget_enforced_before_spend(client):
    # broke-key has 0 budget → fail-closed with 402 (real enforcement, no upstream needed)
    r = client.post("/v1/chat/completions", json=BODY, headers={"Authorization": "Bearer broke-key"})
    assert r.status_code == 402


def test_valid_key_no_upstream_is_honest_503(client):
    # good-key passes auth + budget, but no upstream configured → real 503, never a fake answer
    r = client.post("/v1/chat/completions", json=BODY, headers={"Authorization": "Bearer good-key"})
    assert r.status_code == 503


def test_guardrail_blocks_matching_content(client):
    body = {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "my password is hunter2"}]}
    r = client.post("/v1/chat/completions", json=body, headers={"Authorization": "Bearer good-key"})
    assert r.status_code == 400  # blocked before upstream/503

def test_guardrail_allows_clean_content(client):
    # clean content passes auth + guardrail + budget, then 503 (no upstream) — proves it got past guardrail
    body = {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hello world"}]}
    r = client.post("/v1/chat/completions", json=body, headers={"Authorization": "Bearer good-key"})
    assert r.status_code == 503

def test_usage_reports_real_budget(client):
    j = client.get("/v1/usage", headers={"Authorization": "Bearer good-key"}).json()
    assert j["budget_cents"] == 1000 and j["remaining_cents"] == 1000
