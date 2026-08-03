"""RuntimePort — the swappable sandbox-execution boundary (§5.3, FR-3.6, Q11).

`SubstrateRuntime` is the default adapter, talking to the Agent Substrate service. A pod-per-session
adapter could implement the same tiny surface. `bind()` returns None when unconfigured (local/tests),
so `cli` nodes degrade honestly instead of pretending to run.
"""
from .substrate import SubstrateRuntime, bind

__all__ = ["SubstrateRuntime", "bind"]
