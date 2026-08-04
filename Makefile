# Agent Studio — M0+ dev targets
API_DIR  := services/api
WEB_DIR  := apps/web
IMAGE    := agent-studio/control-plane:dev
WEB_IMG  := agent-studio/web-console:dev
CLUSTER  := agent-studio
CTX      := kind-agent-studio
# Docker Desktop CLI is not always on PATH for non-interactive shells:
export PATH := $(HOME)/.docker/bin:$(PATH)
export KIND_EXPERIMENTAL_PROVIDER := docker

.PHONY: run-local run-web kind-up kind-redeploy kind-down test

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

## Build image, create kind cluster, deploy Postgres + control plane + web console
kind-up:
	docker build -t $(IMAGE) $(API_DIR)
	docker build -t $(WEB_IMG) $(WEB_DIR)
	kind create cluster --name $(CLUSTER) --config deploy/kind/cluster.yaml
	kind load docker-image $(IMAGE) $(WEB_IMG) --name $(CLUSTER)
	kubectl --context $(CTX) apply -f deploy/kind/api.yaml
	kubectl --context $(CTX) apply -f deploy/kind/web.yaml
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/postgres --timeout=180s
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/control-plane --timeout=180s
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/web-console --timeout=180s
	@echo "\n✅ Agent Studio is up on kind"
	@echo "   API:     http://localhost:8088"
	@echo "   Console: http://localhost:3000\n"

## Rebuild + reload images after a code change (keeps the cluster)
kind-redeploy:
	docker build -t $(IMAGE) $(API_DIR)
	docker build -t $(WEB_IMG) $(WEB_DIR)
	kind load docker-image $(IMAGE) $(WEB_IMG) --name $(CLUSTER)
	kubectl --context $(CTX) -n agent-studio-system rollout restart deploy/control-plane deploy/web-console
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/control-plane --timeout=180s
	kubectl --context $(CTX) -n agent-studio-system rollout status deploy/web-console --timeout=180s

kind-down:
	kind delete cluster --name $(CLUSTER)
