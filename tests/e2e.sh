#!/usr/bin/env bash
set -euo pipefail

# E2E smoke test: login → create 3-node workflow → compile → deploy → run → verify output.
# Usage: API_URL=http://localhost:8088 ./tests/e2e.sh

API="${API_URL:-http://localhost:8088}"

fail() { echo "FAIL: $1" >&2; exit 1; }
step() { echo "── $1"; }

step "login"
TOK=$(curl -sf "$API/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@agentstudio.dev","password":"admin12345"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
[ -n "$TOK" ] || fail "login returned no token"
AUTH="Authorization: Bearer $TOK"

step "create workflow (trigger → transform → end)"
WF=$(curl -sf "$API/api/v1/workflows" \
  -H 'content-type: application/json' -H "$AUTH" \
  -d '{
    "name":"e2e-smoke",
    "spec":{
      "nodes":[
        {"id":"t","type":"trigger_api","config":{"seed":{"x":4}}},
        {"id":"d","type":"transform","config":{"expr":"x * 10","as":"y"}},
        {"id":"e","type":"end"}
      ],
      "edges":[{"source":"t","target":"d"},{"source":"d","target":"e"}]
    }
  }')
WID=$(echo "$WF" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
[ -n "$WID" ] || fail "create returned no workflow id"

step "compile"
COMPILE=$(curl -sf "$API/api/v1/workflows/compile" \
  -H 'content-type: application/json' -H "$AUTH" \
  -d '{
    "nodes":[
      {"id":"t","type":"trigger_api","config":{"seed":{"x":4}}},
      {"id":"d","type":"transform","config":{"expr":"x * 10","as":"y"}},
      {"id":"e","type":"end"}
    ],
    "edges":[{"source":"t","target":"d"},{"source":"d","target":"e"}]
  }')
echo "$COMPILE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['ok'], f'compile failed: {d}'"

step "deploy"
curl -sf "$API/api/v1/workflows/$WID/deploy" \
  -X POST -H 'content-type: application/json' -H "$AUTH" > /dev/null

step "run workflow via deploy surface"
RUN_OUTPUT=$(curl -sf "$API/api/v1/workflows/$WID/run" \
  -X POST -H 'content-type: application/json' -H "$AUTH" \
  -d '{"seed":{"x":4}}')

echo "$RUN_OUTPUT" | grep -q '"y": 40' || fail "expected y=40 in run output"
echo "$RUN_OUTPUT" | grep -q '"event": "done"' || fail "run did not complete (no done event)"

step "verify run trace"
RUN_ID=$(echo "$RUN_OUTPUT" | python3 -c "
import sys,json
for line in sys.stdin:
    line = line.strip()
    if line.startswith('data:') and 'run_id' in line:
        print(json.loads(line[5:])['run_id']); break
")
if [ -n "$RUN_ID" ]; then
  TRACE=$(curl -sf "$API/api/v1/runs/$RUN_ID/trace" -H "$AUTH")
  echo "$TRACE" | python3 -c "
import sys,json; d=json.load(sys.stdin)
assert d['status']=='completed', f'run status: {d[\"status\"]}'
assert len(d['spans'])>=2, f'expected >=2 spans, got {len(d[\"spans\"])}'
print(f'  trace: {len(d[\"spans\"])} spans, {d[\"total_ms\"]}ms total')
"
fi

echo "✅ e2e smoke test passed"
