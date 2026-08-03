"""Postgres-backed agent memory store (FR-7.5). Tenant-scoped; latest write wins on read."""
from __future__ import annotations

from typing import Any

from . import db


class PgMemory:
    def get(self, tenant: str, key: str) -> Any:
        with db.session() as s:
            row = s.scalars(
                db.select(db.Memory)
                .where(db.Memory.tenant_id == tenant, db.Memory.mkey == key)
                .order_by(db.Memory.created_at.desc())
            ).first()
            return row.value if row else None

    def put(self, tenant: str, key: str, value: Any) -> None:
        with db.session() as s:
            s.add(db.Memory(tenant_id=tenant, mkey=key, value=value))
            s.commit()
