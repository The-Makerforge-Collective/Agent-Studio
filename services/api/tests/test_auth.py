"""Real multi-tenancy tests — no mocks. Auth, RBAC, and hard cross-tenant isolation."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./auth_test.db"
os.environ["DEV_RESET_DB"] = "1"
os.environ["JWT_SECRET"] = "test-secret"

import pytest
from fastapi.testclient import TestClient

WF = {"name": "w", "spec": {"nodes": [{"id": "t", "type": "trigger_api"}, {"id": "e", "type": "end"}],
                            "edges": [{"source": "t", "target": "e"}]}}


@pytest.fixture(scope="module")
def client():
    from agentstudio.app import app
    with TestClient(app) as c:
        yield c
    if os.path.exists("auth_test.db"):
        os.remove("auth_test.db")


def _login(client, email, pw):
    return client.post("/api/v1/auth/login", json={"email": email, "password": pw})


def test_unauthenticated_is_rejected(client):
    assert client.get("/api/v1/workflows").status_code == 401


def test_bad_password_rejected(client):
    assert _login(client, "admin@agentstudio.dev", "wrong").status_code == 401


def test_admin_can_login_and_create_users(client):
    tok = _login(client, "admin@agentstudio.dev", "admin12345").json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    # admin creates an editor and a viewer in the SAME tenant
    assert client.post("/api/v1/admin/users", headers=h,
                       json={"email": "editor@acme.dev", "password": "pw", "role": "editor"}).status_code == 200
    assert client.post("/api/v1/admin/users", headers=h,
                       json={"email": "viewer@acme.dev", "password": "pw", "role": "viewer"}).status_code == 200


def test_rbac_viewer_cannot_create_or_deploy(client):
    tok = _login(client, "viewer@acme.dev", "pw").json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.post("/api/v1/workflows", headers=h, json=WF).status_code == 403  # needs editor
    assert client.get("/api/v1/workflows", headers=h).status_code == 200            # viewer can read


def test_cross_tenant_isolation(client):
    # tenant A: the bootstrap admin. Create a workflow as A.
    ta = _login(client, "admin@agentstudio.dev", "admin12345").json()["token"]
    ha = {"Authorization": f"Bearer {ta}"}
    wid = client.post("/api/v1/workflows", headers=ha, json=WF).json()["id"]

    # Build a *separate* tenant B with its own admin, directly in the DB.
    from agentstudio import db
    from agentstudio.auth import hash_password
    with db.session() as s:
        tb = db.Tenant(name="globex")
        ub = db.User(email="admin@globex.dev", password_hash=hash_password("pw"))
        s.add_all([tb, ub]); s.flush()
        s.add(db.Membership(user_id=ub.id, tenant_id=tb.id, role="admin")); s.commit()

    tbk = _login(client, "admin@globex.dev", "pw").json()["token"]
    hb = {"Authorization": f"Bearer {tbk}"}
    # Tenant B cannot see tenant A's workflow in its list...
    assert wid not in [w["id"] for w in client.get("/api/v1/workflows", headers=hb).json()]
    # ...and cannot fetch it directly (404, no leak)...
    assert client.get(f"/api/v1/workflows/{wid}", headers=hb).status_code == 404
    # ...and cannot deploy it.
    assert client.post(f"/api/v1/workflows/{wid}/deploy", headers=hb).status_code == 404
    # Tenant A still can.
    assert client.get(f"/api/v1/workflows/{wid}", headers=ha).status_code == 200
