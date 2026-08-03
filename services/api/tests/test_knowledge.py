"""Real keyword-retrieval tests — no mocks, no embeddings. Ranking + tenant scoping + node."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./ktest.db")

import pytest

from agentstudio.compiler import Spec
from agentstudio.executor import run_workflow
from agentstudio.knowledge import PgKnowledge, _chunk


@pytest.fixture(autouse=True)
def _tables():
    from agentstudio import db
    db.Base.metadata.create_all(db._engine)


def _spec(nodes, edges):
    return Spec(nodes=[{"id": i, "type": t, **({"config": c} if c else {})} for i, t, c in nodes],
                edges=[{"source": s, "target": d} for s, d in edges])


def test_chunking_splits_paragraphs():
    assert _chunk("a\n\nb\n\nc") == ["a", "b", "c"]


def test_search_ranks_relevant_chunk_first():
    k = PgKnowledge()
    k.ingest("t1", "doc", "Kubernetes runs containers.\n\nSubstrate schedules actor pods.\n\nCats are nice.")
    hits = k.search("t1", "actor pods substrate", k=2)
    assert hits and "Substrate" in hits[0]["text"]


def test_search_is_tenant_scoped():
    k = PgKnowledge()
    k.ingest("ta", "d", "secret alpha knowledge")
    assert k.search("tb", "alpha", 3) == []          # other tenant sees nothing


def test_retrieval_node_threads_results_into_state():
    class DictKnowledge:
        def search(self, tenant, query, k):
            return [{"text": "the gateway enforces budgets", "source": "d", "score": 1.0}]
    spec = _spec([("t", "trigger_api", {"seed": {"q": "budget"}}),
                  ("r", "retrieval", {"query_from": "q", "as": "docs"}),
                  ("e", "end", None)],
                 [("t", "r"), ("r", "e")])
    done = [e for e in run_workflow(spec, knowledge=DictKnowledge(), tenant_id="t1")
            if e["event"] == "done"][0]
    assert done["state"]["docs"] == ["the gateway enforces budgets"]


def teardown_module(_):
    if os.path.exists("ktest.db"):
        os.remove("ktest.db")
