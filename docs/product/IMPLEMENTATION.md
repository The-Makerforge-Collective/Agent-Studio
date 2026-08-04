# Agent Studio — Implementation Document

> Companion to `PRD.md`. The PRD defines *what* Agent Studio is and *why*; this document defines *how* it
> is built: locked technical decisions, repository layout, module contracts, data model, the port
> interfaces, the API/SSE surface, and a sequenced build plan. Every section traces back to PRD functional
> requirements (`FR-x.y`), milestones (`M0–M3`), and open questions (`§15-Qn`).

- **Status:** Draft v0.1 (implementation plan; tracks PRD Draft v0.5)
- **Scope of v1:** M0 + M1 spine (native core + the two integrated systems + one autonomous self-build
  loop). Everything past M1 is behind feature flags (PRD R1).
- **Companion decisions:** this doc *commits* the PRD's still-open questions (§15-Q6–Q13) to concrete
  choices — see §2. Revisit there if a decision is contested before M0.

---

## 1. Guiding implementation principles

Carried directly from PRD §8 "Key architectural principles", restated as engineering rules:

1. **Schema-first.** The JSON-Schema node catalog (`/schemas`) is the single source of truth shared by
   UI, spec, compiler, and runtime (FR-2.1). TS and Pydantic types are **generated** from it, never
   hand-authored twice.
2. **Declarative config compiles to runtime.** The spec is the truth; the canvas and the executable graph
   are both *views/derivations* of it (FR-2.2). No behavior exists that isn't expressible in the spec.
3. **Ports & adapters at every risky boundary.** The sandbox runtime, the model provider, the secret
   store, and the checkpoint store are all **ports** with swappable adapters (PRD §8, §15-Q11, R7). This
   is what lets Agent Studio ship regardless of Substrate maturity.
4. **Validate the DAG before running it** (FR-1.2). Cycle/reachability/type checks are a compile step, not
   a runtime surprise.
5. **State lives outside the model.** Orchestration state, approval gates, and revise loops are explicit
   state machines in the control plane (FR-3.4), never implicit in prompt history.
6. **Side effects at the edges.** Pure compiler/planner core; all I/O (K8s, gateway, DB, git) behind
   adapters for testability.
7. **Graceful degradation everywhere.** No embeddings → keyword fallback; no Substrate → pod-per-session;
   no gateway → in-process break-glass (FR-13.7, R7, R9).
8. **Fail closed on safety.** When legality/budget/policy can't be resolved, the run stops, it does not
   proceed (PRD §11 Autonomy safety).
9. **Stateless pods — no authoritative state in RAM.** Every process runs as a pod that can be evicted or
   rescheduled at any instant, so **no correctness-bearing state may live only in process memory.** All
   authoritative state is externalized to a durable store (Postgres / object store / PVC); anything held
   in memory is a **rebuildable cache** whose loss is never a correctness event. This is a hard invariant,
   audited in §4.4. Corollary: SSE streams are resumable from a durable event log, queues/schedules are
   durable, locks/leases use Postgres or the K8s API — never an in-process timer or dict.

---

## 2. Locked technical decisions (resolves PRD §15 open questions)

| PRD Q | Decision | Rationale |
|---|---|---|
| **Q6** operator language | **Go** operator (kubebuilder/controller-runtime); **Python 3.12** control-plane API + compiler | Go is the native K8s controller ecosystem; Python keeps the LLM/agent code where the ecosystem is. Two languages, clean seam (CRDs). |
| **Q7** K8s assumptions | Vanilla Kubernetes **1.28+**; **Gateway API** (not Ingress); **Pod Security Admission = restricted**; **cert-manager** for mTLS bootstrap; **Argo CD** for GitOps; **Keycloak** as OIDC (dual-issuer) | Avoid distro-specific primitives (PRD Q7). Gateway API aligns with agentgateway (FR-13.7). |
| **Q8** image supply chain | Images in an **OCI registry** (Harbor self-hosted / GHCR); built with **BuildKit/Kaniko**; **cosign**-signed; **syft** SBOM; **sigstore policy-controller** admission gate | Self-build rebuilds its own actor images → must be gated + signed (PRD §7.12 FR-12.9, Q8). |
| **Q10** WorkerPool sharing | **Dedicated** pool for the self-build/Meta-Studio tenant; **shared-per-trust-tier** for ordinary agents | PRD FR-12.8 default; balances density vs blast radius. |
| **Q11** Runtime port | Build the **port at M0**; ship **Substrate as the default adapter**; keep **pod-per-session** as the always-available fallback | De-risks Substrate immaturity (R7). Density/latency are optimizations, not correctness. |
| **Q12** gateway topology | **Per-trust-tier shared** agentgateway with **per-tenant CEL policy + budgets**; **dedicated** gateway for the self-build tenant | PRD Q12 recommendation. |
| **Q13** gateway mode | Ship **both**: flat-YAML standalone (local dev) + Go/Gateway-API controller (cluster) | Mirrors control-plane dev/prod split (FR-12.7). |
| **Q3** name | **Agent Studio** (working name) | Resolved in PRD header. |

**Still genuinely open before M0 (owner action required):**
- Node-graph canvas library (React Flow / Rete.js / custom) — see §12.
- Engine substrate: LangGraph OSS primitives vs a thin native graph engine (PRD §10 lists LangGraph;
  we wrap it behind our own `Engine` port so the choice is reversible — §5.4).
- Optimizer/controller seeding (new: **Q14**) — how to seed the FR-8.7 governor's setpoint/gains before
  there is merge history to tune against (§9.6).

---

## 3. Repository layout (monorepo)

```
agent-studio/
├── schemas/                     # SOURCE OF TRUTH: JSON-Schema node catalog + spec schema (FR-2.1)
│   ├── nodes/*.schema.json       #   one file per node type (§9 PRD catalog)
│   ├── spec.schema.json          #   workflow spec envelope
│   └── codegen/                  #   generators → Pydantic (py) + TS types
├── services/
│   └── api/                     # Python 3.12 control plane (FastAPI)  — FR-3, FR-4, FR-5, FR-7..9
│       └── agentstudio/
│           ├── api/              #   routers: workflows, runs(SSE), tools, knowledge, connectors,
│           │                     #           deploy, traces, meta_studio, auth
│           ├── compiler/         #   spec → executable graph (FR-2.2); expr evaluator; DAG validation
│           ├── runtime/          #   orchestrator, Engine port, checkpointer, SSE, HITL, topo-parallel
│           ├── nodes/            #   node type implementations (one module per catalog entry)
│           ├── providers/        #   kind-keyed provider registry (FR-4.1); resolves to gateway routes
│           ├── runtimeport/      #   Runtime port + adapters: substrate/, pod/ (FR-3.6, Q11)
│           ├── safety/           #   legality, authz receipts, circuit breaker, tool policy (FR-5)
│           ├── knowledge/        #   RAG, repo KB, eval loop (FR-7.1-7.3)
│           ├── memory/           #   memory + nightly consolidation (FR-7.5)
│           ├── skills/           #   document→skill ingestion (FR-7.4)
│           ├── review/           #   jury, debate, premortem, quality_gate, optimizer, governor (FR-8)
│           ├── observability/    #   span waterfall, cost meter, failure classifier (FR-9)
│           ├── deploy/           #   deploy surfaces: run_api, mcp_server, widget, email, scheduler (FR-10)
│           ├── connectivity/     #   agentgateway client + break-glass fallbacks (FR-13)
│           ├── metastudio/       #   self-build drivers + workflow loading (§6)
│           ├── secrets/          #   SecretStore port + adapters (env/KMS/vault)
│           └── db/               #   SQLAlchemy models + Alembic migrations
├── operator/                    # Go kubebuilder operator (FR-12.1, FR-12.2, FR-12.6) — see §7
│   ├── api/v1alpha1/             #   CRD types + kubebuilder markers: AgentDeployment, Schedule, Credential
│   ├── internal/controller/      #   reconcilers (reconcile-don't-create)
│   └── config/                   #   kustomize: crd/ · rbac/ (marker-generated) · manager/
├── apps/web/                    # Next.js/React console + BFF (FR-1, FR-12.5)
├── actors/                      # coding-CLI actor base images → ActorTemplates (FR-4.3, FR-12.9)
│   ├── base/                     #   common sandbox base (token guard + eBPF attribution sidecars)
│   └── {claude-code,codex,cursor,aider,gemini}/
├── deploy/                      # kustomize overlays, Gateway API config, Argo CD apps, agentgateway conf
├── workflows/                   # Meta Studio workflow SPECS (YAML) targeting this repo (§6)
│   ├── agent-studio-dev.yaml
│   ├── rag-self-tuner.yaml
│   ├── arch-deepening-sweep.yaml
│   └── self-docs-wiki.yaml
└── docs/                        # generated + authored docs
```

**Vendored/integrated (not in this repo, deployed by `deploy/`):** Agent Substrate (Go) and agentgateway
(Rust + Go controller). Pinned by version; tracked upstream (R7). See §10, §11.

---

## 4. Data model — two tiers (shared control plane + per-agent store)

Data splits by access pattern, and the split is load-bearing for isolation (FR-12.1, PRD §16 metric
"zero cross-namespace incidents"):

- **Tier 1 — Control-plane DB (one, central, in `agent-studio-system`).** Inherently *cross-cutting*
  metadata: the console lists all workflows, the operator reconciles all agents, budgets/costs roll up
  across agents. This **cannot** be per-agent or the control plane has nothing to query. Row-level
  tenancy (`tenant_id`) + RBAC (FR-12.5).
- **Tier 2 — Per-agent/workflow data store (one *per agent*, provisioned into the agent's namespace).**
  An agent's *own* domain + runtime data — knowledge/vectors, memory, sessions, checkpoints, skills. Each
  agent gets its own store so a fault, data leak, or noisy-neighbor load in one agent never reaches
  another (shares the namespace blast-radius boundary, FR-12.1).

Primary keys are ULIDs. **The control-plane `runs` row is an *index* (pointer + rollup); the heavy
run/session/checkpoint bodies live in the owning agent's Tier-2 store.**

### 4.1 Tier 1 — Control-plane DB (shared)
| Table | Purpose | Key columns |
|---|---|---|
| `tenants`, `users`, `projects` | Multi-tenancy root (FR-12.5) | `id`, `oidc_sub`, RBAC scopes |
| `agents` | A deployed agent/workflow + a pointer to its Tier-2 store | `id`, `project_id`, `namespace`, `datastore_dsn_ref`, `isolation_tier` |
| `workflows` | A named workflow | `id`, `project_id`, `name`, `head_version_id` |
| `workflow_versions` | Immutable spec snapshots (FR-2.2) | `id`, `workflow_id`, `spec_json`, `compiled_hash`, `created_by` |
| `deployments` | A version deployed to a surface + namespace (FR-10, FR-12.1) | `id`, `version_id`, `surface`, `namespace`, `status` |
| `runs` (index) | Run pointer + cost rollup; body lives in Tier 2 (FR-3.3, FR-9.1) | `id`, `agent_id`, `version_id`, `status`, `started_at`, `cost_cents` |
| `approval_requests` | Durable pending yes/no HITL decision (§5.7); a run's pause is a row, not RAM | `id`, `run_id`, `action`, `state_fingerprint`, `state`(pending/approved/rejected/expired), `approver`, `reason`, `expires_at` |
| `authorization_receipts` | Single-use, state-fingerprinted approvals (FR-5.2) | `id`, `transition`, `state_fingerprint`, `expires_at`, `used`, `issuer(kind)` |
| `budgets` | Per-tenant/workflow ceilings, rolled up across agents (FR-9.1, R6) | `scope`, `limit_cents`, `spent_cents`, `window` |
| `tool_policies` | Per-tool allow/deny YAML (FR-5.4) | `tool_id`, `policy_yaml` |
| `scheduled_jobs` | Durable scheduler/triggers (FR-10.2); polled `FOR UPDATE SKIP LOCKED` — no in-proc cron | `id`, `cron`, `next_fire_at`, `payload`, `locked_by`, `lease_expires_at` |
| `work_queue` | Durable at-least-once queue (self-build items, async tasks) — no in-proc queue | `id`, `topic`, `payload`, `state`, `visible_at`, `attempts` |
| `credentials`, `connectors`, `oauth_tokens` | BYOK + OAuth registry (FR-4.1, FR-6.3), encrypted at rest | `id`, `kind`, `enc_blob`, `scopes` |
| `governor_state` | FR-8.7 controller state (self-build tenant scope) | `scope`, `setpoint`, `pv_ewma`, `integral`, `output`, `floor` |

### 4.2 Tier 2 — Per-agent data store (one per agent)
Same schema instantiated once per agent; provisioned by the operator alongside the `AgentDeployment`
(§7). Postgres + pgvector (prod) with an identical migration set applied per store.
| Table | Purpose | Key columns |
|---|---|---|
| `run_nodes` (spans) | Per-node span waterfall (FR-9.1) | `id`, `run_id`, `node_id`, `model`, `tokens`, `cost_cents`, `t_start/t_end`, `status` |
| `checkpoints` | Durable resumable state (FR-3.7) | `id`, `run_id`, `state_blob`, `seq` |
| `handoff_artifacts` | Explicit inter-node handoffs (FR-3.3) | `id`, `run_id`, `from_node`, `to_node`, `payload` |
| `sessions`, `session_events` | Human-readable + compressed replayable streams (FR-9.3) | `id`, `run_id`, `event_type`, `compressed` |
| `knowledge_sources`, `chunks` | RAG store; `chunks.embedding vector` via pgvector (FR-7.1) | `source_id`, `text`, `embedding`, `bm25_tsv` |
| `skills` | Ingested document→skill assets (FR-7.4) | `id`, `manifest`, `body` |
| `memories` | Agent memory substrate (FR-7.5) | `id`, `agent_id`, `kind`, `body`, `consolidated_at` |
| `eval_sets`, `optimizer_runs` | RAG self-eval + FR-8.6 optimizer trials (per agent) | `id`, `metric`, `trials_json`, `winner_config` |

### 4.3 Per-agent isolation dial (mirrors the WorkerPool dial, FR-12.8)
The *physical* form of a Tier-2 store is a policy dial, same isolation⋈density trade-off as compute:

| Profile | Tier-2 realization | When |
|---|---|---|
| **Density** (default, ordinary agents) | **schema-per-agent** (or a `database`-per-agent) on a shared managed Postgres, fronted by **PgBouncer** | most agents |
| **Strict** (self-build tenant, high-value) | **dedicated Postgres instance** in the agent's namespace | R2/R3 blast-radius; self-build |
| **Local** (`ENV=local`, kind — §16.4) | collapse to **schemas in one Postgres, or SQLite files** — no per-agent pods | dev/CI |

**Operational costs (accepted, not hidden):**
- **Migrations fan out** — the same migration set runs across N Tier-2 stores; the operator owns per-agent
  schema-version tracking and applies migrations as a gated job (a stuck/failed migration marks the agent
  `Degraded`, never silently skipped).
- **Connection pooling** — mandatory PgBouncer (or per-namespace pooler) so many stores don't exhaust
  connections.
- **Cross-agent queries** — anything spanning agents (fleet cost, global search) reads Tier 1 rollups or
  fans out read-only; it never joins across Tier-2 stores.

**Secrets rule (PRD §11):** no secret material ever lands in `session_events`, `run_nodes`, `checkpoints`,
or actor snapshots, in either tier. Credentials are referenced by id and minted at the gateway per hop
(FR-6.6, FR-13.5). A Tier-2 store's DSN is itself a `SecretStore` reference (`agents.datastore_dsn_ref`),
never inlined.

### 4.4 Statelessness audit (realizes §1 principle 9)
Every stateful mechanism resolves to a durable store; in-memory is cache-only. **No Redis in the required
path** — the primitives people reach Redis for are served by Postgres so there is no separate in-memory
store to lose.

| Concern | ❌ In-memory temptation | ✅ Durable realization |
|---|---|---|
| Run / orchestration state | LangGraph state in process | Postgres `checkpoints` after each node (FR-3.7); any pod resumes from last checkpoint |
| HITL pause | awaiting coroutine in RAM | persisted state row; resume via `POST /runs/{id}/resume` (§6) survives restart |
| SSE streaming | connection buffer in the serving pod | frames are durable rows in `session_events`; clients reconnect with `Last-Event-ID` and replay by offset — any API replica can serve the resume |
| Live run events across API replicas | in-process pub/sub | **Postgres `LISTEN/NOTIFY`** (or the durable `session_events` tail); no in-memory bus |
| Scheduler / triggers (FR-10.2) | in-process timer / cron thread | durable `scheduled_jobs` table polled with `SELECT … FOR UPDATE SKIP LOCKED`; a lost pod loses no schedule |
| Work queue (per-item self-build, etc.) | Python `queue.Queue` | Postgres-backed queue (`SKIP LOCKED`) — at-least-once, visible, restart-safe |
| Locks / leader election | in-proc mutex | Postgres **advisory locks**; operator uses the K8s **Lease** API (already, §7 `cmd/main.go`) |
| Rate limiting | per-pod counter | enforced at the **gateway** (FR-13.5); budgets are durable rows (`budgets`), fail-closed if the counter is unavailable |
| Semantic / prompt cache (FR-9.1) | fine as cache | rebuildable; may sit in a cache tier but is **never authoritative** — a miss just recomputes |
| Token-spiral breaker (FR-5.3) | per-session RAM in the actor | recomputed from the **replayable event stream** on resume; the actor's RAM is non-authoritative (below) |
| Dev store | SQLite on pod ephemeral disk | **local only** (outside cluster); *inside* a pod, dev storage sits on a **PVC** or uses in-cluster Postgres — never pod-ephemeral disk |

**Actor RAM is explicitly non-authoritative.** On the default kind path (pod-per-session) there are no
Substrate RAM snapshots at all; even with the Substrate adapter, durable run state (checkpoints, handoffs)
lives in the control plane (FR-3.7) so a snapshot is an *optimization*, never the source of truth. Substrate's
own "in-memory state store" (§8.1) is therefore not on our correctness path — losing it re-derives from
Tier-1/Tier-2 durable state.

**Transient exception (allowed):** a decrypted secret held in RAM only for the duration of a single gateway
token-exchange (§14) is transient use, not stored state — it is never persisted and never outlives the hop.

---

## 5. Control-plane modules & contracts

### 5.1 Node catalog & schema (FR-2.1)
- `/schemas/nodes/*.schema.json` is authoritative. Each node type declares: `type`, `inputs`, `outputs`,
  `config` (JSON Schema), and `middleware` allowance (agent nodes only, FR-2.4).
- `schemas/codegen/` emits: `agentstudio/nodes/generated.py` (Pydantic v2 models) and
  `apps/web/src/generated/nodes.ts`. **CI fails if generated files drift from schemas.**
- Adding a node = a schema file + a builder entry + a `NodeExecutor` (§5.5). No other edits.

### 5.2 Compiler (FR-2.2)
Pipeline (pure, side-effect free):
```
parse(spec) → validate_against_schema → build_graph
  → check_dag (cycles, broken edges, unreachable) → reachability_report   # FR-1.2
  → type_check_state (typed state schema)
  → lower_to_engine (router conditional edges, value→target, expr-guarded routing)
  → attach_middleware (per agent node)                                     # FR-2.4
  → CompiledGraph(hash)
```
- **Safe expression evaluator:** a restricted AST evaluator (no attribute access to builtins, no imports,
  whitelisted ops) for router/branch guards. Unit-tested against an injection corpus.
- Output `compiled_hash` is stored on `workflow_versions` and used to cache compilation.

### 5.3 The four ports (the swap points)
Defined as Python `Protocol`s; each has ≥2 adapters and a **shared contract test suite** every adapter
must pass.

```python
class RuntimePort(Protocol):                     # FR-3.6, Q11
    async def schedule_session(self, spec: SessionSpec) -> SessionHandle: ...
    async def resume(self, handle: SessionHandle) -> None: ...      # sub-second on Substrate
    async def suspend(self, handle: SessionHandle) -> None: ...     # snapshot
    def stream_events(self, handle: SessionHandle) -> AsyncIterator[Event]: ...  # SSE back to CP
    async def kill(self, handle: SessionHandle) -> None: ...        # per-workflow kill switch (R2)
# adapters: runtimeport/substrate/ (default), runtimeport/pod/ (fallback, no suspend/resume)

class ModelPort(Protocol):                       # FR-4.1/4.2 — always resolves to a gateway route
    async def complete(self, route: ModelRoute, req: ChatRequest) -> ChatResponse: ...
# adapter: connectivity/gateway_client (OpenAI-compatible); break-glass: direct-provider (local only)

class CheckpointStore(Protocol): ...             # FR-3.7 — pg adapter (prod), sqlite (dev)
class SecretStore(Protocol): ...                 # FR-6.6 — KMS/vault (prod), env-encrypted (dev)
```

### 5.4 Engine / orchestrator (FR-3)
- Wraps LangGraph OSS primitives behind an internal `Engine` interface so the primitive choice is
  reversible (PRD §10 language note). Responsibilities:
  - **SSE streaming** frames: `run`, `node_start`, `messages`, `node_end`, `hitl_pause`, `error`, `done`
    (FR-3.1). Frames are **persisted to `session_events` before emit** and carry a monotonic id, so a
    dropped client reconnects with `Last-Event-ID` and any API replica replays from that offset — the
    stream is durable, not a buffer in the serving pod (§4.4).
  - **Topological-layer parallelism** — nodes in one layer run concurrently via an async task group
    *within a single node's work*; the authoritative layer/edge state is the checkpoint, so a lost pod
    re-derives progress from Postgres, not from the task group (FR-3.2, §4.4).
  - **Durable resume** — checkpoint after each node; a killed session sandbox resumes from the last
    checkpoint (FR-3.3, FR-3.7). HITL pauses are persisted state, survive restarts.
  - **Structured-output repair** — on malformed JSON/YAML, one bounded repair pass before failing (FR-3.5).
  - **State machine** — approval gates + bounded-revise loops are explicit; an errored reviewer =
    `INCONCLUSIVE`, never a silent pass (FR-3.4).

### 5.5 Node executor contract (FR-2.1)
```python
class NodeExecutor(Protocol):
    type: str
    config_model: type[BaseModel]
    async def run(self, ctx: RunContext, inputs: NodeInputs) -> NodeOutputs: ...
```
`RunContext` exposes: `models` (ModelPort), `runtime` (RuntimePort), `secrets`, `legality` (FR-5.1),
`budget` (FR-9.1), `emit(event)` for SSE, and `checkpoint()`. Heavy/untrusted node types (`agent`,
containerized-CLI, `code` tool) run their body **inside a sandboxed actor** via RuntimePort; light nodes
(`router`, `transform`, `join`) run in-process.

### 5.6 Safety layer (FR-5) — always-on
- **Legality runtime (FR-5.1):** `inspect_move` (non-mutating) vs `attempt_transition` (mutating). The
  model proposes; the runtime decides from explicit state + evidence TTL + gates + receipts.
- **Authorization receipts (FR-5.2):** issued by an automated gate *or* a human; bound to one transition +
  state fingerprint + expiry + single-use. Required for every merge/deploy/spend.
- **Token-spiral circuit breaker (FR-5.3):** energy-function monitor, **zero extra LLM calls**, runs as an
  in-actor sidecar; trips → classifies failure → emits OTel attributes.
- **Tool policy (FR-5.4):** eBPF per-tool attribution inside the actor (Linux-only, optional); the YAML
  policy schema + audit format are required cross-platform.
- **Egress governance (FR-5.5):** enforced at the gateway; in-process SSRF guard as local-mode fallback.

### 5.7 Human yes/no approval gate (FR-3.4, FR-5.2)
A concrete human-in-the-loop decision that pauses a run before an irreversible action and requires an
explicit **approve / reject** from a user. This is the mechanism behind the per-workflow approval toggle
(PRD §6.1) and the `compliance-strict` forced-approver (§17.3).

**Flow (durable at every step — §4.4):**
1. **Pause.** The `approval` node (or any action requiring a receipt — merge/deploy/over-budget spend)
   creates a row in `approval_requests` (`state=pending`), computes the **state fingerprint** of the exact
   proposed transition, and **checkpoints** the run. The awaiting run is *persisted state*, not a coroutine
   in RAM — any pod can serve the resume (§1 principle 9).
2. **Notify.** The pending decision is surfaced to the authorized approver(s): a console inbox badge, and
   optionally email/webhook/Slack (reusing the deploy-surface notifiers, FR-10). The message states *what*
   will happen (the diff/plan/spend), *why*, and the fingerprint.
3. **Decide.** The approver submits **yes (approve)** or **no (reject)** with an optional reason:
   `POST /runs/{id}/approve  { decision: "approve" | "reject", reason?, request_id }`.
   - **Approve →** mints a **single-use, state-fingerprinted, expiring authorization receipt** (FR-5.2)
     bound to that exact transition; the run resumes and performs the action. If state changed since the
     request (fingerprint mismatch), the receipt is invalid → re-request (no approving a stale plan).
   - **Reject →** the item does **not** proceed; it routes back to the bounded-revise loop (with the reason
     as feedback) or stops, per node config.
4. **Expire / fail-closed.** Each request has a TTL. No decision within TTL → **auto-reject (deny)**,
   consistent with §1 principle 8. Never a silent timeout-pass.
5. **Audit.** Who decided, when, yes/no, reason, and the state fingerprint are written to the tamper-evident
   `audit_log` (§17.2); the receipt records the human `issuer` (FR-5.2).

**Config (per workflow / per action):**
```yaml
approval:
  required_for: [merge, deploy, spend_over]     # which irreversible actions gate on a human yes/no
  spend_over_cents: 500
  approvers: { rbac_scope: "agent:approve" }     # who may decide
  ttl_minutes: 60                                # expiry → auto-reject
  default: off                                   # off for trusted self-build; compliance-strict forces on
```
Multi-approver (N-of-M) and approver ≠ author (segregation of duties, §17.3) are policy options. The gate
is off by default for trusted self-build tasks (PRD §6.1) and **forced on** by the `fedramp`/`compliance-
strict` profiles (§17.4).

---

## 6. API & SSE surface (FR-3.1, FR-10.1)

REST (FastAPI, under `/api/v1`), all tenant-scoped via OIDC/BFF (FR-12.5):

| Method + path | Purpose |
|---|---|
| `POST /workflows` / `GET /workflows/{id}` | CRUD workflow |
| `POST /workflows/{id}/versions` | Save a spec version (compiles, validates DAG) |
| `POST /workflows/{id}/compile` | Compile-only (returns DAG/reachability errors) |
| `POST /runs` (SSE) | Start a run; streams `run/node_start/messages/node_end/done` frames |
| `POST /runs/{id}/resume` | Resume after HITL pause (FR-3.3) |
| `GET /runs/{id}/approvals` | List pending yes/no approval requests for this run (§5.7) |
| `POST /runs/{id}/approve` | Submit a **yes/no** decision `{decision: approve\|reject, reason?, request_id}` → mints/denies an authorization receipt (§5.7, FR-5.2) |
| `GET /approvals?state=pending` | Approver inbox across runs (console badge, §5.7) |
| `GET /runs/{id}/trace` | Span waterfall + per-node cost (FR-9.1) |
| `POST /deployments` | Deploy a version to a surface + namespace (FR-10, FR-12.1) |
| `POST /tools`, `GET /connectors`, `POST /connectors/{k}/oauth` | Tool builder + connectors (FR-6) |
| `POST /knowledge/sources`, `POST /knowledge/query` | RAG (FR-7.1) |
| `POST /meta-studio/dev` | Kick the self-build loop (or via scheduler/trigger) (§6) |

**Deploy surfaces** (FR-10.1) each wrap a deployed version: `/run` HTTP API, MCP server (FR-6.4/13.2),
embeddable widget, email channel, scheduler/trigger.

---

## 7. Kubernetes substrate (FR-12) — the Go operator (kubebuilder)

`operator/` is a **kubebuilder** project (controller-runtime under the hood) — the committed choice for
the Kubernetes operator/reconciler (§2-Q6).

**Scaffolding (reproducible from zero):**
```bash
# operator/
kubebuilder init  --domain agentstudio.dev --repo github.com/agent-studio/operator
kubebuilder create api --group agentstudio --version v1alpha1 --kind AgentDeployment --resource --controller
kubebuilder create api --group agentstudio --version v1alpha1 --kind Schedule        --resource --controller
kubebuilder create api --group agentstudio --version v1alpha1 --kind Credential      --resource --controller
```
This yields the standard kubebuilder layout, which maps onto §3 as:
```
operator/
├── PROJECT                      # kubebuilder project manifest
├── Makefile                     # kubebuilder targets: manifests, generate, test (envtest), docker-build, deploy
├── cmd/main.go                  # manager entrypoint (leader election, health/ready probes, metrics)
├── api/v1alpha1/                # CRD Go types + `+kubebuilder:` markers → generated CRDs/DeepCopy
│   ├── agentdeployment_types.go
│   ├── schedule_types.go
│   └── credential_types.go
├── internal/controller/         # one Reconciler per Kind (controller-runtime)
└── config/                      # kustomize: crd/ · rbac/ (from // +kubebuilder:rbac markers) · manager/ · webhook/
```

**CRDs (`api/v1alpha1`), defined via kubebuilder markers** (`+kubebuilder:validation`, `:subresource:status`,
`:printcolumn`):
- **`AgentDeployment`** — desired state for a deployed workflow: provisions a dedicated **namespace** with
  `ResourceQuota`/`LimitRange`/`ServiceAccount`/scoped RBAC/`NetworkPolicy` (default-deny egress +
  allowlist to gateway) (FR-12.1), **plus the agent's Tier-2 data store** per the isolation dial (§4.2/4.3)
  — schema/database on the shared cluster (density) or a dedicated Postgres in-namespace (strict) — then
  runs its migration set as a gated job and writes the DSN reference to `agents.datastore_dsn_ref`. Carries
  a `.status` subresource + conditions for the store-ready + health-check rollout gates.
- **`Schedule`**, **`Credential`** — declarative triggers + cred refs reconciled into the namespace.

**Conventions locked with kubebuilder:**
- RBAC is generated from `// +kubebuilder:rbac:groups=...` markers on each reconciler — never hand-written
  (keeps least-privilege honest).
- CRD manifests + DeepCopy come from `make manifests generate`; **CI fails on drift** (same rule as the
  schema codegen in §5.1).
- Reconcilers use `controllerutil.CreateOrUpdate` / owner references + finalizers for
  reconcile-don't-create semantics and clean namespace teardown.
- Tests use **envtest** (`make test`), asserting idempotency (reconcile twice = no-op) — §12.

Reconcilers are **idempotent (reconcile-don't-create)** and stream status via watch informers (FR-12.2).
The workflow spec is the desired state; Argo CD syncs Git → cluster. **Rollouts are health-checked; a
failed check auto-rolls-back** and reports to the self-build deploy gate (FR-12.6, §6.1).

**Isolation ⋈ density (FR-12.8):** each tenant/agent → its own K8s **namespace** + Substrate **Atespace**
+ a **WorkerPool** whose sharing is a policy dial (§2 Q10). Cross-tenant actors never co-locate on a
worker.

**Local dev (FR-12.7):** primary local target is **kind** (see §16 for the full bootstrap). Because kind
is real Kubernetes, **namespaces, RBAC, quotas, and NetworkPolicy are genuinely exercised** — the operator
reconciles real namespaces, not label-degraded stand-ins (the "namespaces → labels" degrade only applies to
a non-K8s bare-container path, which we do not target). The spec/compiler are identical, so local → cluster
is a no-change deploy; only the Runtime adapter and a few host-dependent features degrade (§16.4).

---

## 8. Integrated systems

### 8.1 Agent Substrate (FR-12.3, §7.12) — default RuntimePort adapter
- Components deployed via `deploy/`: `ate-api-server`, `atecontroller` (CRDs `ActorTemplate`/`WorkerPool`/
  `SandboxConfig`), `atelet` (DaemonSet), `ateom`, `atenet`, `podcertcontroller`, snapshot object store +
  state store.
- **Adapter responsibility:** map `SessionSpec` → an Actor addressed by `(atespace, name)`; drive
  suspend→snapshot / resume-on-traffic; stream actor events back over SSE.
- **Golden-snapshot ActorTemplates (FR-12.9):** each coding-CLI image (`actors/`) is published as an
  immutable `ActorTemplate`; a new version = a new template; the self-build image pipeline bumps it under
  a gated, cosign-signed build (Q8).
- **Fallback (Q11, R7):** `runtimeport/pod/` — cold pod-per-session, no suspend/resume, lower density.
  Both adapters pass the same contract-test suite (§5.3).

### 8.2 agentgateway (FR-13, §7.13) — the connectivity fabric
All actor↔world traffic (LLM, tools, agents) flows through it; namespaces `deny-egress except gateway`.
- **LLM gateway (FR-13.1):** one OpenAI-compatible endpoint; per-node model selection resolves to a
  route; budgets/failover/semantic routing centralized; **actors hold no provider keys**.
- **MCP gateway (FR-13.2):** federate MCP servers; expose OpenAPI as MCP; the Tool Builder registers
  through it.
- **A2A mesh (FR-13.3):** elevates the `handoff` node to a protocol across isolation boundaries.
- **Guardrails / CEL RBAC / rate-limit / HBONE mTLS / token-exchange / OTel** (FR-13.4–13.6): the single
  wire-level enforcement + metering point; feeds the cost meter authoritatively (FR-9.1).
- **Topology (Q12):** per-trust-tier shared gateway + per-tenant CEL/budgets; dedicated for self-build.
- **Break-glass (R9):** in-process MCP/egress fallback for local/standalone mode only.

---

## 9. Review, optimization & control nodes (FR-8)

Each is a `NodeExecutor` under `review/`:
- **9.1 `jury` (FR-8.1)** — N differently-modeled judges + synthesizing arbiter.
- **9.2 `adversarial_debate` (FR-8.2)** — attacker vs defender, adaptive rounds, convergence detection; a
  concession = confirmed issue.
- **9.3 `premortem` (FR-8.3)** — severity-rated stress test.
- **9.4 `quality_gate` (FR-8.4)** — configurable hard gates + bounded revise loops; wired as the gate set
  in the self-build loop (§6.1).
- **9.5 `optimizer` (FR-8.6)** — **offline, episodic** parameter tuning: LLM translates NL goal → targets/
  weights; evolutionary (PSO/differential-evolution) or Bayesian search iterates against a replayable/
  simulatable evaluator; keep-or-discard; winner written back as a versioned spec change. First consumer:
  the RAG self-tuner (§6.2 / FR-7.3).
- **9.6 `governor` (FR-8.7)** — **online, continuous** PI/PID regulation of the self-build loop over many
  runs. Setpoint = target escaped-defect/rollback rate; PV = EWMA-filtered measured rate; actuator =
  autonomy aggressiveness + review-stringency (within clamps). **Hard constraints in code:** (a) safety/
  test/legality gates never regulated (bounded band *above* the floor); (b) asymmetric ratchet — any red
  safety gate / bad deploy snaps stringency to max; (c) dead-time handling — windup-clamped integral,
  debounced derivative. State in `governor_state`.
  - **Open Q14 (seeding):** before merge history exists, seed with conservative gains + max stringency and
    only relax after a fixed number of clean autonomous merges. Needs an owner decision before M1.

---

## 10. Meta Studio — the self-build workflows (§6)

`workflows/*.yaml` are ordinary Agent Studio specs whose target repo is this repo:
- **`agent-studio-dev.yaml` (§6.1):** Intake → Plan (multi-model ensemble → PRD → atomic items) →
  per-item Implement (Substrate actor: coding CLI in isolated git worktree, iterative auto-fix) → Review
  (`jury` + `adversarial_debate` + `premortem`) → Verify (build/test/lint/security **hard gates**) →
  Merge (auto on all-green) → Deploy (namespaced rollout, auto-rollback) → Docs. Gated by the
  `governor` (§9.6); human approval opt-in, off by default.
- **`rag-self-tuner.yaml` (§6.2):** drives the `optimizer` node against an F-beta eval set.
- **`arch-deepening-sweep.yaml` (§6.2):** proposer + independent verifier (verifier never sees proposer
  reasoning, FR-8.5) → files ready-to-implement items.
- **`self-docs-wiki.yaml` (§6.3):** regenerates the `file:line`-cited wiki on each merge; citation-lint is
  a gate; guarded publish refuses default branch + scans for secrets (FR-11.1).

**Blast-radius controls (R2, R3):** worktree isolation, no control-plane host access, propose/verify,
hard automated gates, auto-rollback, per-workflow kill switch, and a **canary namespace** that validates
self-changes before they touch `agent-studio-system`. Control-plane changes deploy to canary first; the
supervising operator is change-frozen except under human approval (R3).

---

## 11. Web console (`apps/web`, FR-1)

- Next.js/React, **BFF pattern** holding OIDC tokens server-side (FR-12.5).
- Node-graph canvas (library TBD, §2/§12): palette, config side-panel, edge routing, live test panel,
  inline DAG errors (FR-1.1/1.2).
- **Spec ⇄ canvas round-trip** over the same schema-generated TS types (FR-1.4).
- Design system: light warm-neutral + dark charcoal tokens (FR-1.3).
- Surfaces: canvas, Meta Studio dashboard, run trace waterfall (FR-9.1), embed generator.

---

## 12. Testing & verification strategy

| Layer | What | Tooling |
|---|---|---|
| Unit | Compiler passes, safe expression evaluator (injection corpus), each `NodeExecutor` | pytest |
| Golden | Spec fixtures → expected compiled graph; snapshot DAG-validation errors | pytest + fixtures |
| **Port contract** | One suite each RuntimePort/ModelPort/CheckpointStore/SecretStore adapter must pass | pytest, parametrized over adapters |
| Integration | End-to-end on `kind`: provision namespace, deploy 3-node agent, hit `/run` | pytest + kind in CI |
| **Statelessness (chaos)** | Kill the API/runner pod mid-run; assert the run resumes from checkpoint and the SSE client replays via `Last-Event-ID` with zero lost frames (§1 principle 9, §4.4) | kind + pod-kill in CI |
| **Compliance policy-as-code** | Control-matrix coverage gate (every in-scope control has a test+evidence); OPA/Conftest + Kyverno policy unit tests; a non-conformant workload is rejected at admission (§17.8) | Conftest, Kyverno test, CI |
| Self-build dry-run | `agent-studio-dev` against a scratch branch; assert gates block a seeded bad change | CI job |
| **Gate efficacy** | Seeded-defect corpus; measure % caught before merge vs single-model baseline (PRD §16) | eval harness |
| Operator | envtest reconcile loops; idempotency (reconcile twice = no-op) | Go envtest |
| Web | Component + canvas round-trip; Playwright e2e | vitest + Playwright |

**Verify skill hook:** nontrivial changes are exercised end-to-end (drive the flow, observe behavior),
not just typechecked — mirrors the self-build Verify gate.

---

## 13. Milestone → engineering workstream mapping

Mirrors PRD §12; each item is a shippable workstream with an exit criterion.

### M0 — Hand-built core on Kubernetes
1. `schemas/` node catalog + codegen (3-node minimum: `trigger_api`, `agent`, `end`).
2. Compiler + DAG validation + safe expr evaluator.
3. Engine/orchestrator: SSE, checkpointing, HITL pause.
4. Provider registry → ModelPort → gateway client.
5. **RuntimePort** + both adapters (Substrate default, pod fallback) passing the contract suite.
6. Go operator: `AgentDeployment` → namespace provisioning + reconciler.
7. agentgateway (LLM + MCP) deployed; namespaces deny-egress-except-gateway.
8. `/run` deploy surface.
- **Exit (PRD M0):** visually build a 3-node agent, deploy into its own namespace, hit its `/run` API; a
  coding-CLI node executes in a sandboxed actor and reaches models only through the gateway.

### M1 — Autonomous Meta Studio v0 (first self-build)
1. `agent-studio-dev.yaml` end-to-end (plan→items→actor:CLI+worktree→auto-fix→jury/debate/premortem→
   verify→auto-merge→rollout).
2. Full safety layer (legality, receipts, circuit breaker, tool policy, guardrails, auto-rollback).
3. Repo knowledge base (FR-7.2); cost/trace observability (FR-9).
4. `governor` (FR-8.7) with conservative seeding (Q14); canary namespace (R2/R3).
- **Exit (PRD M1):** a real feature is planned, coded, reviewed, merged, deployed by the loop with no
  human click; a bad change is caught by a gate or rolled back.

### M2 — Capability breadth
Tool builder (REST/GraphQL/SQL/code/MCP + JMESPath projection), OAuth connector registry, knowledge/RAG +
skills ingestion, memory + consolidation, more deploy surfaces (MCP server, widget, email, scheduler),
A2A multi-agent, self-docs wiki, RBAC/SSO hardening. **Exit:** build a non-trivial external agent and
deploy it 3 ways into its own namespace.

### M3 — Self-improvement + hardening
`rag-self-tuner` + `arch-deepening-sweep` feeding the Dev loop; multi-tenant hardening (NetworkPolicy,
quotas, CEL); multi-host export + plugin packaging; optional desktop build. **Exit:** an Agent
Studio-authored retrieval improvement ships autonomously (metric-gated); two isolated agents run
concurrently in separate namespaces. **Success = crossover:** ≥50% of merged PRs originate autonomously
from Meta Studio (PRD §16).

---

## 14. Cross-cutting: security & secrets implementation (PRD §11)
- BYOK creds encrypted at rest (`credentials.enc_blob` via `SecretStore`); decrypt only in-memory at the
  gateway token-exchange (FR-13.5), never in actors.
- No secret in trace/span/snapshot/log — enforced by a redaction middleware on the observability path +
  a CI grep gate on fixtures.
- Actors: PSA-restricted, seccomp, default-deny egress, no control-plane host access (R2, R8).
- Snapshots encrypted at rest, per-atespace scoped, short TTL, access-audited (R8).
- Fail-closed when legality/budget can't resolve (§1 rule 8).

---

## 15. Open items to lock before coding (owner action)
1. **Node-graph canvas library** (§11/§12).
2. **Engine substrate** — LangGraph vs thin native engine (behind `Engine` port either way) (§5.4).
3. **Q14 governor seeding** — gains + relax criteria before merge history exists (§9.6).
4. Registry choice (Harbor vs GHCR) + signing key custody (§2 Q8).
5. Concrete Substrate + agentgateway pinned versions (R7, R9).
6. **Tier-2 default isolation profile** (§4.3) — schema-per-agent vs database-per-agent for ordinary
   agents, and where the shared managed Postgres for the density profile is hosted. (Strict = dedicated
   in-namespace is already settled for the self-build tenant.)
7. **Q15 — first-certification target: LOCKED to SOC 2 Type II + GDPR** (§17.7). Remaining sub-decision:
   the cloud boundary/region for the reference deployment (drives GDPR residency + any later FedRAMP boundary).

---

## 16. Local development on kind (first-class, non-negotiable target)

**Requirement:** the entire platform must come up on a single **kind** cluster on a dev laptop
(Linux/macOS), with **zero external cloud dependencies**. This is both the M0 authoring environment and
the CI substrate — the *same* control plane and operator that run in a real cluster, so `kind → cluster`
is a no-change deploy (FR-12.7, PRD §11 offline/local-first). If it doesn't run on kind, it isn't done.

### 16.1 One-command bootstrap
`make kind-up` creates the cluster and brings the stack up in `agent-studio-system`:
```yaml
# deploy/kind/cluster.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - { containerPort: 30080, hostPort: 8080 }   # control-plane API (/api/v1)
      - { containerPort: 30300, hostPort: 3000 }   # web console
      - { containerPort: 30900, hostPort: 9000 }   # agentgateway (OpenAI-compat + MCP)
```
`make kind-up` then, in order: create cluster → install **Gateway API CRDs** → `make manifests` + apply
operator CRDs → **`kind load docker-image`** for locally-built images (api, operator, actor base, gateway)
so **no registry is needed** → apply `deploy/kind/` kustomize overlay → wait for readiness. `make kind-down`
tears it all down. A **Tilt**/**Skaffold** file gives hot-reload on the API and web during development.

### 16.2 What runs in-cluster on kind
| Component | On kind | Notes |
|---|---|---|
| Control-plane API (FastAPI) | Deployment in `agent-studio-system` | NodePort 30080 |
| Go operator (kubebuilder) | Deployment | reconciles `AgentDeployment` → real namespaces, quotas, NetworkPolicy |
| agentgateway | single Deployment, **standalone flat-YAML mode** (FR-13.7, §2-Q13) | NodePort 30900 |
| Postgres + pgvector | pods on a **PVC** (prod-parity path) | zero-infra path uses in-cluster Postgres; SQLite is for *outside-cluster* dev only (§4.4) |
| (no Redis) | — | queue/pub-sub/locks are Postgres primitives; an optional cache tier may exist but is never authoritative (§4.4) |
| Web console | Deployment (or `next dev` on host → cluster API) | NodePort 30300 |
| Deployed agents | one real namespace each | namespace isolation is genuinely exercised on kind |

### 16.3 The one real gotcha — Substrate on kind ⇒ pod-per-session
Agent Substrate's density runtime (gVisor/microVM snapshot suspend/resume) **generally cannot nest inside
kind** on a laptop — Docker Desktop on macOS is itself a VM with no nested virtualization, and eBPF
attribution is Linux-only (PRD Portability, R7). This is precisely why the **Runtime port** exists (§5.3,
§2-Q11):

- On kind-local, `RuntimePort` **defaults to the `pod/` (pod-per-session) adapter** — the coding-CLI runs
  as an ordinary pod in the agent's namespace. **No** snapshot suspend/resume, lower density — but
  **functionally identical**, because both adapters must pass the same port contract-test suite (§5.3,
  §12). Density/latency are optimizations, not correctness (R7).
- The `substrate/` adapter is enabled where it can actually run: Linux hosts / real clusters with a gVisor
  `RuntimeClass` available. A laptop on Linux *may* enable gVisor; macOS defaults to pod-per-session.

### 16.4 Local degradations (explicit, per §1 rule 7)
| Capability | Cluster/Linux | kind-local default |
|---|---|---|
| Session runtime | Substrate actor (sub-second resume) | **pod-per-session** (no suspend/resume) |
| eBPF per-tool attribution (FR-5.4) | on (Linux) | **off** — YAML policy schema + audit still enforced |
| Token-spiral circuit breaker (FR-5.3) | in-actor sidecar | on (pure-Python guard, no native wheel) |
| agentgateway | Gateway-API controller | **standalone flat-YAML**; in-process break-glass if omitted (R9) |
| Image signing/admission (Q8) | cosign + sigstore policy-controller | **local keys or skip** (dev profile) |
| Snapshots at rest (R8) | encrypted object store | N/A (no suspend) |
| Storage | Postgres+pgvector (PVC); no Redis | Postgres pods (PVC) **or** SQLite+embedded vectors *(outside-cluster dev only)* |

Degradations are **config profiles** (`ENV=local`), not code forks — the same binaries, different adapters
and flags. Nothing on the safety-*correctness* path is disabled (legality, receipts, budgets, fail-closed
all stay on); only performance/hardening features that are physically host-dependent degrade.

### 16.5 Self-build on kind
`agent-studio-dev` (§10) runs on kind against a scratch git worktree using the pod-per-session actor; the
**canary namespace** (R2/R3) is just another namespace on the same cluster. This lets the whole autonomous
loop — plan → code → review → verify → merge (to a scratch branch) → deploy-to-canary → rollback — be
demoed and tested end-to-end on a laptop with no cloud.

### 16.6 Acceptance (ties to M0 exit, §13)
`make kind-up && make e2e` must, entirely locally: provision a per-agent namespace, deploy a visually-built
3-node agent into it, hit its `/run` API, and confirm the coding-CLI node executed in a sandboxed
(pod-per-session) actor reaching models **only** through the gateway. This *is* the M0 exit criterion,
runnable offline.

---

## 17. Compliance & regulatory alignment

**Honest framing (read first).** Software is never "compliant" by itself — compliance is a
**shared-responsibility** outcome of technical controls **+** operator process **+** an independent audit.
What Agent Studio commits to is shipping the **technical control surface** that makes certification against
the major frameworks *achievable*, plus **evidence automation** so audits are cheap. Claiming blanket
"compliant to all frameworks" would be false; the accurate claim is **"designed to be certifiable, with
configurable compliance profiles."** Some frameworks additionally require a specific *deployment* (e.g.
FedRAMP → a government cloud boundary) that is an operator responsibility, not a code artifact.

### 17.0 Readiness status — DO NOT misread this doc as a compliance claim
| Stage | State |
|---|---|
| **Designed** — controls specified, architecture won't block an audit | ✅ this doc |
| **Built** — controls implemented and running | ❌ not started (design phase) |
| **Operating + evidenced** — controls demonstrably run over a window, evidence collected | ❌ needs a live system |
| **Audited** — independent assessor certifies | ❌ external, per-framework |

**Current state = DESIGNED. Agent Studio is NOT certified/compliant.** The accurate external phrasing is
*"architected to be certifiable, with configurable compliance profiles."* Path to first cert in §17.7.

### 17.0.1 Design approach — one strict baseline, profiles add only deltas (the "most frameworks" strategy)
"Compliant to most frameworks" is achieved by **building to the highest common denominator**, not by piling
up special cases. ~80% of SOC 2 / ISO 27001 / GDPR / HIPAA / PCI DSS / NIST 800-53 requirements are the
**same control families**. We build that common core to the strictest reasonable level and turn it **on by
default for every tenant** (not gated behind a profile). A compliance **profile (§17.4)** then layers only
the framework-specific *delta*. Consequence: an ordinary deployment already satisfies the shared core of
most frameworks; adding a new framework is a small delta, not a re-architecture.

**Always-on baseline (every deployment, no profile required):**
| Baseline control | Realization |
|---|---|
| Strong authN + least-privilege authZ | OIDC/SSO (MFA-capable), scope-aware RBAC, row-level tenancy, per-agent isolation (§4, FR-12.5) |
| Encryption everywhere | mTLS in transit (FR-13.5); AES-256 at rest, **FIPS-capable** modules; BYOK/KMS |
| **Tamper-evident audit logging** | hash-chained `audit_log`, append-only, always on (§17.2) — *baseline, not optional* |
| Secrets hygiene | gateway-minted per hop; never in logs/traces/snapshots/DB (§14, §4.4) |
| Change management + traceability | GitOps desired-state, gated pipeline, receipts, auto-rollback (§7, §6.1, §17.3) |
| Data protection | classification + PII redaction available; retention + **erasure** workflow (§17.2) |
| Supply-chain integrity | cosign-signed images, SBOM, sigstore admission, dependency scanning (§2-Q8) |
| Monitoring + alerting → IR | wire-level OTel, failure classification, budgets; alerts feed incident response (FR-9) |
| Network segmentation + hardening | namespace-per-agent, default-deny egress, PSA-restricted, seccomp (FR-12.1) |
| Backup / DR | PITR for Tier-1 + every Tier-2 store + snapshots; documented RPO/RTO (§17.2) |

Everything in this baseline is **built early (M1–M2) and always on** — the strictness costs little and buys
breadth. Profiles (§17.4) only add deltas like PHI-tagging (HIPAA), tokenized PAN (PCI), gov-cloud + forced
human approval (FedRAMP), or region-pinning + no-train (GDPR).

### 17.1 Control surface already in the architecture
Most framework requirements map to controls the design already carries — this section makes the mapping
explicit rather than adding much new:

| Control family | Where it already lives |
|---|---|
| **Access control / least privilege** | OIDC/SSO + scope-aware RBAC (FR-12.5); Postgres row-level tenancy + per-agent Tier-2 isolation (§4); marker-generated operator RBAC (§7); gateway CEL RBAC (FR-13.5) |
| **Encryption in transit** | HBONE **mTLS** between every hop (FR-13.5); TLS at the edge |
| **Encryption at rest** | BYOK, secrets encrypted (`SecretStore`); encrypted snapshots (R8); Tier-1/2 DB + PVC encryption |
| **Secrets management** | minted at the gateway per hop; never in logs/traces/snapshots/DB bodies (§14, §4.4) |
| **Audit trail** | single-use **authorization receipts** on every irreversible action (FR-5.2); wire-level OTel for every LLM/tool/agent hop (FR-13.6) |
| **Network segmentation** | namespace-per-agent + default-deny egress + allowlist-to-gateway (FR-12.1) |
| **Vulnerability / supply chain** | cosign-signed images + SBOM + sigstore admission (§2-Q8) |
| **Change management** | GitOps desired-state + gated pipeline + auto-rollback (§7, §6.1) — but see §17.3 |
| **Monitoring / logging** | span waterfall + failure classification + budgets/quotas (FR-9) |
| **Data isolation / multi-tenancy** | two-tier data model, per-agent stores, cross-tenant actors never co-locate (§4, FR-12.8) |

### 17.2 Baseline controls to build (always-on common core — §17.0.1)
Not yet in the earlier sections, required by *most* frameworks, so built as **always-on baseline** (M1–M2,
not behind a profile) rather than per-framework add-ons:
- **Tamper-evident audit log** — a dedicated append-only `audit_log` (Tier-1) with **hash-chained**
  entries (each row carries `prev_hash`), covering auth, RBAC changes, credential access, every
  merge/deploy/spend, and every autonomous self-build action. Exportable; WORM-optional to object store.
- **Data retention & right-to-erasure (GDPR Art. 17, CCPA)** — per-tenant retention policies; erasure is
  clean because a subject's agent data lives in its **own Tier-2 store** (drop schema/DB = provable
  deletion), with a documented `data_subject_request` workflow.
- **Data residency / region pinning** — `tenants.region` + `agents.region`; the operator schedules the
  namespace, Tier-2 store, gateway, and snapshot storage **within-region only**; cross-region egress is
  policy-denied at the gateway. (GDPR/Schrems II, data-sovereignty regimes.)
- **Data classification & PII handling** — dataset/field tagging; the PII-redaction middleware (FR-2.4) is
  mandatory on classified paths; DLP-style egress guardrails at the gateway (FR-13.4).
- **BC/DR** — backup + PITR for Tier-1 and every Tier-2 store and snapshot storage (FR-12.10); documented
  RPO/RTO; restore drills in CI.
- **Sub-processor / model-provider governance** — a registry of which model/tool providers a tenant's data
  may traverse, enforced at the gateway route (FR-13.1); **"no-train" / zero-retention** provider flags for
  regulated tenants.
- **Evidence automation** — a job that renders receipts + audit-log + OTel + gate results into
  audit-ready evidence packs (SOC 2 / ISO control evidence), so the self-documenting property (FR-11.1)
  extends to compliance evidence.

### 17.3 The hard one: autonomy ⋈ change-management / segregation-of-duties
Traditional SOC 2 / ISO 27001 / SOX change-management assumes a **human** approves production changes and
that duties are **segregated**. The self-build loop **auto-merges with no human click** (§6.1) — this is
the single biggest compliance tension in the product, and it must be answered head-on, not hidden.

**Position:** the autonomous gates are a **stronger, fully-audited compensating control set**, and the
mapping is explicit:
- **Segregation of duties** → **propose/verify separation** (FR-8.5, verifier never sees proposer
  reasoning) + the ensemble `jury`/`adversarial_debate` are independent actors; no single agent both
  writes and approves.
- **Authorized change** → every merge/deploy is a single-use, state-fingerprinted **authorization receipt**
  (FR-5.2); the *issuer* is the automated gate, recorded immutably (§17.2 audit log).
- **Tested change** → hard Verify gates (build/test/lint/security) block merge (§6.1).
- **Reversible change** → health-checked rollout + **auto-rollback** + canary namespace (FR-12.6, R2/R3).
- **Human-in-the-loop when required** → the concrete **yes/no approval gate (§5.7)** is a per-workflow
  config toggle (PRD §6.1); the **`compliance-strict` profile forces it on**, restoring a literal human
  approver (approve/reject + reason, single-use receipt, audited) for auditors/regimes that require one.

This lets a customer choose: *fully autonomous* (fast, audited-by-machine) or *human-gated* (for SOX/
FedRAMP-style regimes) — same pipeline, one policy switch.

### 17.4 Compliance profiles (configurable, not hard-coded)
Frameworks are enabled as **profiles** (`compliance: [soc2, hipaa, gdpr, fedramp-moderate, …]`) that flip
enforcement, mirroring the density/isolation dials:

| Profile | What it enforces on top of baseline |
|---|---|
| **SOC 2 / ISO 27001** | tamper-evident audit log on; evidence automation on; access reviews exported |
| **GDPR / CCPA** | region pinning; retention + erasure workflow; no-train provider flags; DPA sub-processor list |
| **HIPAA** | PHI classification mandatory; PII/PHI redaction non-bypassable; BAA-eligible providers only; enhanced audit |
| **PCI DSS** | cardholder-data tagging; tokenization; card data never reaches model context or logs; segmented namespace |
| **FedRAMP / NIST 800-53** | gov-cloud deployment boundary (operator); FIPS-validated crypto; **human approval forced on** (§17.3); continuous monitoring export |
| **AI-specific** | **EU AI Act** (risk classification, human-oversight config, logging), **NIST AI RMF** + **ISO/IEC 42001** (model/provider governance, eval records via FR-8/FR-9) |

**Fail-closed:** if an active profile's control cannot be satisfied (e.g. region-pinned store unavailable,
audit log unwritable), the action is **denied**, consistent with §1 principle 8.

### 17.5 Data-model additions (Tier-1)
| Table / field | Purpose |
|---|---|
| `audit_log` | append-only, hash-chained (`prev_hash`) tamper-evident trail (§17.2) |
| `tenants.region`, `agents.region` | residency pinning (§17.2) |
| `retention_policies`, `data_subject_requests` | retention + erasure workflow (§17.2) |
| `data_classifications` | dataset/field sensitivity tags (§17.2) |
| `subprocessors` | approved model/tool providers per tenant, no-train flags (§17.2) |
| `compliance_profiles` | active profiles per tenant + enforcement config (§17.4) |

### 17.6 What stays the operator's responsibility (shared model)
Certification itself; policies/procedures (IR plan, access reviews, vendor management); personnel controls
(background checks, training); physical/cloud-provider controls (inherited via the CSP's own attestations);
signing the BAA/DPA; and the audit engagement. The platform supplies controls + evidence; the operator
supplies process + attestation.

### 17.7 First-certification target (Q15 — LOCKED) & path
**Locked first target: SOC 2 Type II + GDPR.** SOC 2 is the standard B2B entry point and its Trust Services
Criteria overlap almost entirely with the §17.0.1 baseline; GDPR adds region-pinning + DSR/erasure + no-train,
which regulated buyers ask for early. ISO 27001 follows cheaply from the same evidence; HIPAA/PCI/FedRAMP
are later, demand-driven profiles.

Path:
1. Build the §17.0.1 baseline + §17.2 controls (M1–M2) — always-on.
2. Enable the `soc2` + `gdpr` profiles (§17.4) in the reference deployment.
3. Run **3–12 months** collecting evidence via the evidence-automation job (§17.2) — SOC 2 Type II needs an
   observation window (Type I is a point-in-time pre-step if a faster artifact is needed).
4. Engage a 3PAO/auditor; remediate; certify. ISO 27001 as a fast-follow on shared evidence.

*Remaining sub-decision:* the **cloud boundary/region** for the reference deployment (drives GDPR residency
and any later FedRAMP boundary).

### 17.8 How we *ensure* compliance — continuous enforcement + continuous proof (compliance-as-code)
Compliance is not a one-time pass; it's a continuously-maintained state. We guarantee it the same way we
guarantee code quality — **every control is a machine-checkable gate that fails closed, and coverage is
tracked so a missing control is visible, not discovered at audit.**

**(a) Policy-as-code enforced at three layers (defense in depth; each fails closed — §1 principle 8):**
| Layer | Enforcement | Examples |
|---|---|---|
| **Build-time (CI)** | reuse the self-build **hard-gate** machinery (§6.1) | OPA/Conftest policy checks, SBOM + vuln scan (grype/trivy), secret scanning, license + IaC (checkov) scan — a red gate blocks merge |
| **Admission-time (cluster)** | **Kyverno/Gatekeeper** rejects non-conformant workloads | unsigned images (sigstore), privileged pods, missing `NetworkPolicy`/`ResourceQuota`, non-`restricted` PSA |
| **Runtime (live)** | gateway + reconciler | CEL RBAC + egress + content guardrails (FR-13); eBPF tool policy (FR-5.4); config scanning against framework control packs; **drift → alert + GitOps auto-remediate** |
| **Data-time (scheduled)** | durable jobs (§4.4) | retention/erasure enforcement, classification sweeps, residency checks, DSR fulfilment |

**(b) Control traceability matrix — the "make sure *everything*" device.** A machine-readable map in the
repo:
```
control_matrix.yaml:  <framework>.<control_id> → { technical_control, automated_test, evidence_artifact, owner, status }
```
CI **fails** if any in-scope control lacks a linked automated test or evidence source. A coverage dashboard
shows green/amber/red per framework; **a control with no test is a red gap, not a silent assumption.** This
is how completeness is *guaranteed* rather than hoped.

**(c) Continuous control monitoring (CCM) + evidence automation.** Scheduled agents/jobs continuously
evaluate live controls (Prowler/Cloud-Custodian/Steampipe-style benchmarks + our own checks), map results to
control IDs, feed a **posture dashboard**, alert on drift, and open remediation items that flow into the
self-build Dev loop (§6.1). In parallel, evidence automation (§17.2) renders receipts + `audit_log` + scan
results + access-review exports into **timestamped, immutable evidence packs** mapped to control IDs —
audit-ready at any instant. **Dogfood:** Agent Studio's own jury/verify/gate machinery audits Agent Studio.

**(d) Independent verification.** Periodic pen-tests + red-team; the **propose/verify separation** (FR-8.5)
so no single actor self-certifies; an external **3PAO/auditor** for the actual attestation (§17.6).

**Honest boundary (unchanged from §17.0):** (a)–(c) give continuous *coverage + proof* of the technical
controls; they cannot by themselves produce a certificate. Certification still needs the **process** controls
(access reviews, IR drills, training, vendor management) and a **human auditor**. "Everything compliant" is
therefore an operating posture we **continuously enforce, monitor, and evidence** — and re-verify forever as
code and frameworks change — not a box that gets permanently ticked.

---

*Traceability: every module in §3 maps to PRD FRs cited inline; every milestone in §13 maps to PRD §12;
§2 resolves PRD §15-Q6–Q13 and raises Q14; §16 realizes PRD FR-12.7 + §11 offline/local-first as a hard
target; §17 builds a highest-common-denominator control baseline (always-on) + profile deltas so the design
is **certifiable** (not yet certified — §17.0) against SOC 2 / ISO 27001 / GDPR / HIPAA / PCI DSS /
FedRAMP·NIST 800-53 / EU AI Act·NIST AI RMF·ISO 42001, first target LOCKED to SOC 2 Type II + GDPR (§17.7).*
