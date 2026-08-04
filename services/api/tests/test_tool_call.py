"""Real REST tool_call tests — a genuine local HTTP server, no mocks."""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

os.environ["TOOL_ALLOW_HOSTS"] = "127.0.0.1"    # allow the local test server past the egress guard

from agentstudio.compiler import Spec
from agentstudio.executor import _project, run_workflow


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"data": {"items": [{"name": "widget"}]}}).encode())

    def log_message(self, *a):
        pass


@pytest.fixture(scope="module")
def server():
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def test_project_walks_dicts_and_lists():
    assert _project({"a": {"b": [10, 20]}}, "a.b.1") == 20


def _spec(nodes, edges):
    return Spec(nodes=[{"id": i, "type": t, **({"config": c} if c else {})} for i, t, c in nodes],
                edges=[{"source": s, "target": d} for s, d in edges])


def test_egress_guard_blocks_loopback(monkeypatch):
    monkeypatch.setenv("TOOL_ALLOW_HOSTS", "")     # remove the allowlist for this test
    spec = _spec([("t", "trigger_api", None),
                  ("c", "tool_call", {"url": "http://127.0.0.1:9/x"})],
                 [("t", "c")])
    events = list(run_workflow(spec))
    assert any(e["event"] == "error" for e in events)   # loopback egress blocked (SSRF guard)


def test_tool_call_hits_real_server_and_projects(server):
    spec = _spec([("t", "trigger_api", None),
                  ("c", "tool_call", {"url": server + "/x", "project": "data.items.0.name", "as": "name"}),
                  ("e", "end", None)],
                 [("t", "c"), ("c", "e")])
    done = [e for e in run_workflow(spec) if e["event"] == "done"][0]
    assert done["state"]["name"] == "widget"     # real HTTP round-trip + projection
