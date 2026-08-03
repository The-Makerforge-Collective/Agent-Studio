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

from sqlalchemy import JSON, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from .auth import hash_password

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


class Memory(Base):
    """Agent memory substrate (FR-7.5) — tenant-scoped key/value, latest-wins on read."""
    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_ulid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    mkey: Mapped[str] = mapped_column(String, index=True)
    value: Mapped[Any] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=lambda: time.time())


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
        s.commit()


def session() -> Session:
    return Session(_engine, future=True)


__all__ = ["Tenant", "User", "Membership", "Workflow", "Deployment", "Run", "RunNode", "Memory",
           "init_db", "session", "select", "DATABASE_URL"]
