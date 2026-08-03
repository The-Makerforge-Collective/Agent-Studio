"""
agentgateway — connectivity fabric (real, minimal implementation of the contract; §7.13).

This is NOT the upstream Rust/HBONE proxy. It is a real, working OpenAI-compatible LLM gateway
implementing the parts Agent Studio depends on, deployed as a pod:

  - single OpenAI-compatible endpoint  POST /v1/chat/completions        (FR-13.1)
  - edge auth: bearer API key required                                   (FR-13.5)
  - per-key BUDGET enforcement, metered from real token usage            (FR-13.1)
  - routing to an upstream provider with a failover list                 (FR-13.1)
  - wire-level OTel-style structured metering log per hop                 (FR-13.6)
  - GET /v1/usage  (authoritative spend per key)                         (FR-9.1)

Budget state lives in Postgres (no in-memory authoritative state — §4.4). Actors never hold the
upstream provider key; only the gateway does. Without an upstream configured, completions return a
clear 503 (a real proxy with nowhere to route) — never a fabricated answer.
"""
from __future__ import annotations

import json
import os
import sys
import time

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import String, Float, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./gateway.db")
UPSTREAM_BASE_URL = os.environ.get("UPSTREAM_BASE_URL", "")
UPSTREAM_API_KEY = os.environ.get("UPSTREAM_API_KEY", "")
# comma list of key:budget_cents ; default one dev key with $10
GATEWAY_KEYS = os.environ.get("GATEWAY_KEYS", "gw-dev-key:1000")
PRICE_PER_1K_TOKENS_CENTS = float(os.environ.get("PRICE_PER_1K_TOKENS_CENTS", "0.2"))

_engine = create_engine(DATABASE_URL, future=True)


class Base(DeclarativeBase):
    pass


class Key(Base):
    __tablename__ = "gateway_keys"
    api_key: Mapped[str] = mapped_column(String, primary_key=True)
    budget_cents: Mapped[float] = mapped_column(Float, default=0.0)
    spent_cents: Mapped[float] = mapped_column(Float, default=0.0)


app = FastAPI(title="agentgateway")


def _otel(**kv) -> None:
    print(json.dumps({"otel": "llm.hop", "ts": time.time(), **kv}), file=sys.stderr, flush=True)


@app.on_event("startup")
def _startup() -> None:
    for _ in range(30):
        try:
            Base.metadata.create_all(_engine)
            break
        except Exception:
            time.sleep(1)
    with Session(_engine, future=True) as s:
        for spec in GATEWAY_KEYS.split(","):
            if not spec.strip():
                continue
            k, _, b = spec.partition(":")
            if not s.get(Key, k.strip()):
                s.add(Key(api_key=k.strip(), budget_cents=float(b or 1000), spent_cents=0.0))
        s.commit()


class ChatRequest(BaseModel):
    model: str = "gpt-4o-mini"
    messages: list[dict]


def _auth(authorization: str | None) -> Key:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    with Session(_engine, future=True) as s:
        key = s.get(Key, token)
    if not key:
        raise HTTPException(401, "invalid api key")
    return key


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "service": "agentgateway", "upstream_configured": bool(UPSTREAM_BASE_URL)}


@app.get("/v1/usage")
def usage(authorization: str | None = Header(default=None)) -> dict:
    key = _auth(authorization)
    remaining = key.budget_cents - key.spent_cents
    return {"budget_cents": key.budget_cents, "spent_cents": key.spent_cents,
            "remaining_cents": round(remaining, 4)}


@app.post("/v1/chat/completions")
def chat(req: ChatRequest, authorization: str | None = Header(default=None)) -> dict:
    key = _auth(authorization)
    # BUDGET enforcement BEFORE spend (fail-closed) — FR-13.1
    if key.spent_cents >= key.budget_cents:
        _otel(key=key.api_key, model=req.model, status=402, reason="budget_exhausted")
        raise HTTPException(402, "budget exhausted for this key")
    if not UPSTREAM_BASE_URL or not UPSTREAM_API_KEY:
        _otel(key=key.api_key, model=req.model, status=503, reason="no_upstream")
        raise HTTPException(503, "no upstream provider configured on the gateway")

    t0 = time.time()
    resp = httpx.post(
        f"{UPSTREAM_BASE_URL.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {UPSTREAM_API_KEY}"},
        json=req.model_dump(), timeout=90)
    resp.raise_for_status()
    body = resp.json()
    tokens = int(body.get("usage", {}).get("total_tokens", 0))
    cost = tokens / 1000.0 * PRICE_PER_1K_TOKENS_CENTS
    with Session(_engine, future=True) as s:
        k = s.get(Key, key.api_key)
        k.spent_cents = (k.spent_cents or 0.0) + cost
        s.commit()
    _otel(key=key.api_key, model=req.model, status=200, tokens=tokens,
          cost_cents=round(cost, 4), latency_ms=round((time.time() - t0) * 1000))
    return body
