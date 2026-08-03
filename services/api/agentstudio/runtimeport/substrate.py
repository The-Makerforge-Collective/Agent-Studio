"""Substrate adapter: schedule a real actor pod and collect its output (FR-3.6, FR-4.3)."""
from __future__ import annotations

import os
import uuid
from typing import Any


class SubstrateRuntime:
    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")

    def run_actor(self, namespace: str, atespace: str, image: str,
                  command: list[str], name: str | None = None, timeout: int = 45) -> dict[str, Any]:
        import httpx
        name = name or f"run-{uuid.uuid4().hex[:8]}"
        httpx.post(f"{self.base}/actors", timeout=30, json={
            "atespace": atespace, "name": name, "namespace": namespace,
            "image": image, "command": command})
        r = httpx.get(f"{self.base}/actors/{namespace}/{name}/logs",
                      params={"timeout": timeout}, timeout=timeout + 15)
        r.raise_for_status()
        out = r.json()
        out["actor"] = name
        return out


def bind() -> SubstrateRuntime | None:
    url = os.environ.get("SUBSTRATE_URL")
    return SubstrateRuntime(url) if url else None
