"""Tenant-scoped knowledge store with keyword retrieval (FR-7.1).

The PRD's graceful-degradation path: no embeddings, no model calls — chunks are ranked by query
term-overlap (a simple, deterministic BM25-lite). Real and offline-capable by default.
"""
from __future__ import annotations

import re
from typing import Any

from . import db

_WORD = re.compile(r"[a-z0-9]+")


def _terms(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _chunk(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return parts or ([text.strip()] if text.strip() else [])


class PgKnowledge:
    def ingest(self, tenant: str, source: str, text: str) -> int:
        chunks = _chunk(text)
        with db.session() as s:
            for c in chunks:
                s.add(db.KnowledgeChunk(tenant_id=tenant, source=source, text=c))
            s.commit()
        return len(chunks)

    def search(self, tenant: str, query: str, k: int = 3) -> list[dict[str, Any]]:
        qterms = set(_terms(query))
        if not qterms:
            return []
        with db.session() as s:
            rows = s.scalars(db.select(db.KnowledgeChunk)
                             .where(db.KnowledgeChunk.tenant_id == tenant)).all()
        scored = []
        for r in rows:
            ct = _terms(r.text)
            if not ct:
                continue
            overlap = sum(1 for t in ct if t in qterms)
            if overlap:
                scored.append((overlap / len(ct) + overlap, r.text, r.source))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"text": t, "source": src, "score": round(sc, 3)} for sc, t, src in scored[:k]]
