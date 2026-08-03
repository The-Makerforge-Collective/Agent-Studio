# Agent Studio

Open-source platform for building AI agents and multi-agent workflows visually, running on Kubernetes —
multi-tenant, each agent isolated in its own namespace, with sessions executing as sandboxed actor pods.

> **Status — honest.** The [PRD](PRD.md) and [implementation doc](IMPLEMENTATION.md) describe the full
> vision. This repo contains a **real, running vertical slice** of it on `kind`, built and tested with
> **no stubs or mocks in the logic** — plus real, minimal implementations of the two external
> dependencies. It is **not** the complete PRD: the upstream gVisor/microVM snapshotting (Agent
> Substrate) and Rust/HBONE-mTLS proxy (agentgateway) are not reproduced — this implements each system's
> **contract** as a working service. What runs, runs for real and is verified against the live cluster.

## What runs today (all on kind, all tested)

| Component | Real capability | Contract, not-yet |
|---|---|---|
| **Control plane** (`services/api`) | multi-tenant API, spec→DAG compiler, execution engine (state threading + conditional routing), Postgres persistence, SSE | — |
| **Auth** | **Keycloak OIDC/SSO** (RS256 via JWKS) + local HS256 dual-issuer; RBAC (viewer/editor/admin); **hard tenant isolation** | browser OIDC redirect/BFF flow |
| **agentgateway** (`services/gateway`) | OpenAI-compatible endpoint, edge auth, **per-key budget enforcement** (Postgres), metering | HBONE mTLS, CEL RBAC, MCP/A2A |
| **Agent Substrate** (`services/substrate`) | actor lifecycle — schedules/kills **real pods** in agent namespaces, streams session output | gVisor/microVM, snapshot suspend/resume |
| **Isolation** | namespace-per-agent: `ResourceQuota` + default-deny `NetworkPolicy`, provisioned on deploy | full Go kubebuilder operator |
| **Execution** | `cli` nodes run as **Substrate actor pods** in the tenant's namespace (RuntimePort) | warm WorkerPool multiplexing |

**33 tests** across the three services, run in CI on every push.

## Architecture (running slice)

```
 Keycloak (OIDC/SSO)
      │  RS256 token (roles + tenant claim)
      ▼
 Control plane (FastAPI, multi-tenant)  ──deploy──▶  agent namespace (Quota + default-deny NetworkPolicy)
   compiler · execution engine · RBAC          run│
      │                                           ▼
      │  cli node ──RuntimePort──▶  Agent Substrate ──▶ actor Pod (in tenant namespace)
      │                                           
      └─ agent node ──▶ agentgateway (auth + budget) ──▶ [model provider]
   Postgres (Tier-1 control-plane DB)
```

## Quickstart (local, on kind)

Requires Docker (or Podman) + `kind` + `kubectl`.

```bash
make kind-up          # build images, create cluster, deploy everything → http://localhost:8088
# ...then in the browser, sign in as admin@agentstudio.dev / admin12345 (local dual-issuer)
# or use Keycloak users alice/alice12345 (admin), bob/bob12345 (viewer)
make kind-down        # tear it all down
```

`make kind-redeploy` rebuilds + reloads the control-plane image after a code change.

## Tests

```bash
make test             # runs pytest for control plane, gateway, and substrate
```

## Repository layout

```
services/api/          control-plane API (compiler, engine, auth/RBAC, persistence, RuntimePort)
services/gateway/      agentgateway — LLM connectivity fabric (auth + budget)
services/substrate/    Agent Substrate — actor runtime (session-as-pod)
deploy/kind/           kind cluster config + manifests (Postgres, Keycloak, gateway, substrate, API)
PRD.md                 product requirements (the full vision)
IMPLEMENTATION.md      implementation plan (how the full thing is built)
```

## License

Apache-2.0 (see [LICENSE](LICENSE)) — matches the PRD's core-license intent.
