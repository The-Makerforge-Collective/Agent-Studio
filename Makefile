# Agent Studio — M0+ dev targets
API_DIR  := services/api
WEB_DIR  := apps/web
IMAGE    := localhost/agent-studio/control-plane:dev
WEB_IMG  := localhost/agent-studio/web-console:dev
CLUSTER  := agent-studio
CTX      := kind-agent-studio
export KIND_EXPERIMENTAL_PROVIDER := podman

.PHONY: run-local run-web kind-up kind-redeploy kind-down test e2e codegen

## Run all test suites (control plane, gateway, substrate)
test:
	@for svc in api gateway substrate; do \
	  echo "== testing $$svc =="; \
	  ( cd services/$$svc && python3 -m venv .venv >/dev/null 2>&1; \
	    .venv/bin/pip install -q -r requirements.txt pytest cryptography >/dev/null 2>&1; \
	    DATABASE_URL="sqlite:///./ci.db" DEV_RESET_DB=1 JWT_SECRET=ci-secret .venv/bin/python -m pytest tests/ -q ) || exit 1; \
	  rm -f services/$$svc/ci.db; \
	done

## Run the control plane as a local process (no cluster) → http://localhost:8090
run-local:
	cd $(API_DIR) && python3 -m venv .venv && . .venv/bin/activate && \
	  pip install -q -r requirements.txt && \
	  uvicorn agentstudio.app:app --host 0.0.0.0 --port 8090

## Run the web console in dev mode → http://localhost:3000
run-web:
	cd $(WEB_DIR) && npm install && npm run dev

## Build image, create kind cluster, deploy all components
kind-up:
	podman build -t $(IMAGE) $(API_DIR)
	podman build -t $(WEB_IMG) $(WEB_DIR)
	kind create cluster --name $(CLUSTER) --config deploy/kind/cluster.yaml
	podman save $(IMAGE) | kind load image-archive /dev/stdin --name $(CLUSTER)
	podman save $(WEB_IMG) | kind load image-archive /dev/stdin --name $(CLUSTER)
	kubectl --context $(CTX) apply -f deploy/kind/api.yaml
	kubectl --context $(CTX) apply -f deploy/kind/web.yaml
	kubectl --context $(CTX) apply -f deploy/kind/keycloak.yaml
	kubectl --context $(CTX) apply -f deploy/kind/gateway.yaml
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/postgres --timeout=180s
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/keycloak --timeout=180s
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/control-plane --timeout=180s
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/web-console --timeout=180s
	@echo "\n✅ Agent Studio is up on kind"
	@echo "   API:      http://localhost:8088"
	@echo "   Console:  http://localhost:3000"
	@echo "   Keycloak: http://localhost:8083\n"

## Rebuild + reload images after a code change (keeps the cluster)
kind-redeploy:
	podman build -t $(IMAGE) $(API_DIR)
	podman build -t $(WEB_IMG) $(WEB_DIR)
	podman save $(IMAGE) | kind load image-archive /dev/stdin --name $(CLUSTER)
	podman save $(WEB_IMG) | kind load image-archive /dev/stdin --name $(CLUSTER)
	kubectl --context $(CTX) -n agent-studio-system rollout restart deploy/control-plane deploy/web-console
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/control-plane --timeout=180s
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/web-console --timeout=180s

kind-down:
	kind delete cluster --name $(CLUSTER)

## End-to-end smoke test against the running cluster
e2e:
	@echo "== e2e smoke test =="
	@curl -sf http://localhost:8088/health | grep -q ok && echo "  API health: ok" || (echo "  API health: FAIL" && exit 1)
	@curl -sf http://localhost:3000 > /dev/null && echo "  Web console: ok" || (echo "  Web console: FAIL" && exit 1)
	@curl -sf http://localhost:8088/api/v1/nodes | grep -q catalog && echo "  Node catalog: ok" || (echo "  Node catalog: FAIL" && exit 1)
	@echo "✅ e2e smoke test passed"

## Generate TS types from the running node catalog API
codegen:
	cd $(WEB_DIR) && node scripts/codegen-nodes.mjs
