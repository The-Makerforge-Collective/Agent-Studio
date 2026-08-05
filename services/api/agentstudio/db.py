"""Persistence (Tier-1 control-plane DB, §4.1) — now multi-tenant (FR-12.5).

Every tenant-scoped row carries tenant_id for row-level isolation. Users authenticate against
`users`; `memberships` bind a user to a tenant with an RBAC role.

DEV_RESET_DB=1 (default in this dev build) drops+recreates the control-plane tables on startup so
schema changes apply without a migration tool; set to 0 to persist across restarts.
"""
from __future__ import annotations

import os
import time
import uuid
from typing import Any

from sqlalchemy import JSON, Boolean, String, create_engine, or_, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

import base64
import hashlib as _hashlib

from cryptography.fernet import Fernet

from .auth import hash_password, JWT_SECRET

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./agentstudio.db")
_engine = create_engine(DATABASE_URL, future=True)


def _ulid() -> str:
    return uuid.uuid4().hex[:26]


class Base(DeclarativeBase):
    pass


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    name: Mapped[str] = mapped_column(String, unique=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(String)


class Membership(Base):
    __tablename__ = "memberships"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    user_id: Mapped[str] = mapped_column(String)
    tenant_id: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="viewer")


class Workflow(Base):
    __tablename__ = "workflows"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    spec: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())
    public: Mapped[bool] = mapped_column(Boolean, default=False)


class Deployment(Base):
    __tablename__ = "deployments"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    workflow_id: Mapped[str] = mapped_column(String)
    namespace: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True, default="")
    workflow_id: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="running")
    started_at: Mapped[float] = mapped_column(default=lambda: time.time())
    finished_at: Mapped[float] = mapped_column(default=0.0)
    error_message: Mapped[str] = mapped_column(String, default="")


class KnowledgeChunk(Base):
    """RAG store (FR-7.1) — tenant-scoped text chunks, keyword-searchable (no embeddings needed)."""
    __tablename__ = "knowledge_chunks"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    source: Mapped[str] = mapped_column(String, default="")
    text: Mapped[str] = mapped_column(String)
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())


class Memory(Base):
    """Agent memory substrate (FR-7.5) — tenant-scoped key/value, latest-wins on read."""
    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    mkey: Mapped[str] = mapped_column(String, index=True)
    value: Mapped[Any] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())


class ApprovalRequest(Base):
    """Durable human-in-the-loop pause (§5.7). Holds the resume context until a yes/no decision."""
    __tablename__ = "approval_requests"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    run_id: Mapped[str] = mapped_column(String, index=True)
    node_id: Mapped[str] = mapped_column(String)
    state: Mapped[str] = mapped_column(String, default="pending")  # pending/approved/rejected
    context: Mapped[Any] = mapped_column(JSON)                      # {spec, reached, executed, state}
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())


class Schedule(Base):
    """Scheduled trigger (FR-10.2) — fires a workflow every interval_seconds."""
    __tablename__ = "schedules"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    workflow_id: Mapped[str] = mapped_column(String)
    interval_seconds: Mapped[int] = mapped_column(default=60)
    next_fire_at: Mapped[float] = mapped_column(default=0.0)
    enabled: Mapped[bool] = mapped_column(default=True)
    last_run_id: Mapped[str] = mapped_column(String, default="")


class Skill(Base):
    """Reusable agent skill in agentskills.io format."""
    __tablename__ = "skills"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String, default="")
    spec: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())


class McpServer(Base):
    """Registered remote MCP server providing tools to agent nodes."""
    __tablename__ = "mcp_servers"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    url: Mapped[str] = mapped_column(String)
    transport: Mapped[str] = mapped_column(String, default="streamable-http")
    auth_header: Mapped[str] = mapped_column(String, default="")
    headers: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    tools: Mapped[dict[str, Any]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="pending")
    created_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())


class LlmProvider(Base):
    """Tenant-scoped LLM provider config with encrypted API key."""
    __tablename__ = "llm_providers"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    provider_type: Mapped[str] = mapped_column(String, default="openai")
    base_url: Mapped[str] = mapped_column(String, default="")
    api_key_encrypted: Mapped[str] = mapped_column(String, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(_hashlib.sha256(JWT_SECRET.encode()).digest())
    return Fernet(key)


def encrypt_api_key(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_api_key(cipher: str) -> str:
    return _fernet().decrypt(cipher.encode()).decode()


class RunNode(Base):
    """Per-node span for the run's span waterfall (FR-9.1)."""
    __tablename__ = "run_nodes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    run_id: Mapped[str] = mapped_column(String, index=True)
    tenant_id: Mapped[str] = mapped_column(String, index=True, default="")
    seq: Mapped[int] = mapped_column(default=0)
    node_id: Mapped[str] = mapped_column(String)
    node_type: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="ok")
    t_start: Mapped[float] = mapped_column(default=0.0)
    t_end: Mapped[float] = mapped_column(default=0.0)
    duration_ms: Mapped[int] = mapped_column(default=0)


def init_db(retries: int = 30) -> None:
    reset = os.environ.get("DEV_RESET_DB", "1") == "1"
    last: Exception | None = None
    for _ in range(retries):
        try:
            if reset:
                Base.metadata.drop_all(_engine)
            Base.metadata.create_all(_engine)
            _bootstrap()
            return
        except Exception as e:  # pragma: no cover
            last = e
            time.sleep(1)
    raise RuntimeError(f"DB not ready after {retries}s: {last}")


def _bootstrap() -> None:
    """Seed an initial admin + tenant so there's a way in (like a first-run superuser)."""
    email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "admin@agentstudio.dev")
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "admin12345")
    tname = os.environ.get("BOOTSTRAP_TENANT", "acme")
    with Session(_engine, future=True) as s:
        if s.scalar(select(User).where(User.email == email)):
            return
        tenant = Tenant(name=tname)
        user = User(email=email, password_hash=hash_password(password))
        s.add_all([tenant, user])
        s.flush()
        s.add(Membership(user_id=user.id, tenant_id=tenant.id, role="admin"))
        _seed_demo_workflows(s, tenant.id)
        s.commit()


_DEMO_WORKFLOWS = [
    ("Hello World", {
        "nodes": [
            {"id": "trigger", "type": "trigger_api", "config": {"seed": {"name": "World"}}},
            {"id": "greet", "type": "transform", "config": {"expr": "\"Hello, \" + name + \"!\"", "as": "greeting"}},
            {"id": "done", "type": "end", "config": {}},
        ],
        "edges": [{"source": "trigger", "target": "greet"}, {"source": "greet", "target": "done"}],
    }),
    ("Priority Router", {
        "nodes": [
            {"id": "trigger", "type": "trigger_api", "config": {"seed": {"priority": 8}}},
            {"id": "check", "type": "router", "config": {"when": "priority > 5", "true": "urgent", "false": "normal"}},
            {"id": "urgent", "type": "transform", "config": {"expr": "\"URGENT: priority=\" + str(priority)", "as": "result"}},
            {"id": "normal", "type": "transform", "config": {"expr": "\"normal: priority=\" + str(priority)", "as": "result"}},
        ],
        "edges": [
            {"source": "trigger", "target": "check"},
            {"source": "check", "target": "urgent"},
            {"source": "check", "target": "normal"},
        ],
    }),
    ("Math Pipeline", {
        "nodes": [
            {"id": "trigger", "type": "trigger_api", "config": {"seed": {"x": 10}}},
            {"id": "double", "type": "transform", "config": {"expr": "x * 2", "as": "doubled"}},
            {"id": "add", "type": "transform", "config": {"expr": "doubled + 100", "as": "result"}},
            {"id": "done", "type": "end", "config": {}},
        ],
        "edges": [
            {"source": "trigger", "target": "double"},
            {"source": "double", "target": "add"},
            {"source": "add", "target": "done"},
        ],
    }),
    ("Quality Gate", {
        "nodes": [
            {"id": "trigger", "type": "trigger_api", "config": {"seed": {"score": 85}}},
            {"id": "scale", "type": "transform", "config": {"expr": "score / 10", "as": "scaled"}},
            {"id": "gate", "type": "quality_gate", "config": {"checks": [{"expr": "scaled > 5", "name": "min-threshold"}]}},
        ],
        "edges": [{"source": "trigger", "target": "scale"}, {"source": "scale", "target": "gate"}],
    }),
    ("Sentiment Router", {
        "nodes": [
            {"id": "trigger", "type": "trigger_api", "config": {"seed": {"sentiment": "positive", "value": 42}}},
            {"id": "check", "type": "router", "config": {"when": "sentiment == \"positive\"", "true": "happy", "false": "sad"}},
            {"id": "happy", "type": "transform", "config": {"expr": "\"Great news! Value is \" + str(value)", "as": "message"}},
            {"id": "sad", "type": "transform", "config": {"expr": "\"Oh no. Value is \" + str(value)", "as": "message"}},
        ],
        "edges": [
            {"source": "trigger", "target": "check"},
            {"source": "check", "target": "happy"},
            {"source": "check", "target": "sad"},
        ],
    }),
    ("Data Pipeline", {
        "nodes": [
            {"id": "trigger", "type": "trigger_api", "config": {"seed": {"items": 5, "price": 20}}},
            {"id": "total", "type": "transform", "config": {"expr": "items * price", "as": "subtotal"}},
            {"id": "tax", "type": "transform", "config": {"expr": "subtotal * 1.08", "as": "total_with_tax"}},
            {"id": "check", "type": "router", "config": {"when": "total_with_tax > 100", "true": "big", "false": "small"}},
            {"id": "big", "type": "end", "config": {}},
            {"id": "small", "type": "end", "config": {}},
        ],
        "edges": [
            {"source": "trigger", "target": "total"},
            {"source": "total", "target": "tax"},
            {"source": "tax", "target": "check"},
            {"source": "check", "target": "big"},
            {"source": "check", "target": "small"},
        ],
    }),
]


def _seed_demo_workflows(s: Session, tenant_id: str) -> None:
    for name, spec in _DEMO_WORKFLOWS:
        s.add(Workflow(tenant_id=tenant_id, name=name, spec=spec,
                       created_by="system", public=True))


def session() -> Session:
    return Session(_engine, future=True)


__all__ = ["Tenant", "User", "Membership", "Workflow", "Deployment", "Run", "RunNode", "Memory",
           "KnowledgeChunk", "Schedule", "ApprovalRequest", "Skill", "McpServer", "LlmProvider",
           "encrypt_api_key", "decrypt_api_key",
           "init_db", "session", "select", "DATABASE_URL"]
