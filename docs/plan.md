# Agent Studio — Phased Delivery Plan

> Turns the PRD (§12 milestones) and IMPLEMENTATION doc (§13 workstreams) into a sequenced,
> customer-demoable delivery plan. Each phase ends with a concrete demo moment a stakeholder can
> see and evaluate. Phases are cumulative — each builds on the last.

**Current state (as of 2026-08-04):** 22 commits on main. Running slice on kind with: compiler +
DAG validation + expression evaluator, SSE streaming runtime with checkpointing, provider registry
+ gateway client, RuntimePort (substrate + pod fallback), several node types (agent, router,
classifier, subworkflow, parallel_fanout, quality_gate, guardrail, approval, tool_call, knowledge,
memory_read/write), deploy surfaces (/run API, MCP server, widget, scheduler), gateway with rate
limiting + content guardrails + SSRF guard, Prometheus /metrics, and Postgres on PVC. No web
console yet. No Go operator yet. No self-build loop.

---

## Phase 0 — Walking Skeleton (weeks 1–3)

**Goal:** A person can open a browser, see a canvas, drag three nodes, wire them, press Run, and
watch the agent execute — all on a local `kind` cluster. This is the "hello world" moment.

### What to build
1. **Web console scaffold** (`apps/web/`)
   - Next.js app with BFF pattern (OIDC tokens server-side)
   - Node-graph canvas (pick library: React Flow recommended) with a palette sidebar
   - Config side-panel for selected node
   - Spec ⇄ canvas round-trip (edit YAML ↔ canvas stays in sync)
   - Light/dark theme tokens (FR-1.3)

2. **DAG validation surfaced in the UI**
   - Inline canvas errors for cycles, broken edges, unreachable nodes (FR-1.2)
   - Compile button that calls `POST /workflows/{id}/compile`

3. **Schema-driven node catalog in the UI**
   - Auto-generate TypeScript types from `/schemas` (codegen pipeline)
   - Palette populated from the node catalog; config forms generated from JSON Schema

4. **End-to-end kind demo hardened**
   - `make kind-up` brings up API + web console + gateway + Postgres
   - Hot-reload for API + web via Tilt/Skaffold

### Demo moment
> Open `localhost:3000`. Drag `trigger_api` → `agent` → `end` onto the canvas. Configure the agent
> node with a model + prompt. Press "Deploy". Hit the `/run` API. Watch the SSE trace stream into
> a run panel in the console. All local, zero cloud.

### Exit criteria
- Canvas renders, nodes are draggable, edges connect, config saves to spec
- Spec ⇄ canvas round-trip works (edit YAML → canvas updates, and vice versa)
- `make kind-up && make e2e` passes: deploy a 3-node agent, hit `/run`, get a streamed response

---

## Phase 1 — Real Agents on Kubernetes (weeks 4–7)

**Goal:** Deploy an agent that actually does useful work — calls tools, retrieves knowledge, routes
between paths — isolated in its own Kubernetes namespace. This is the "it's a real platform" moment.

### What to build
1. **Go operator (kubebuilder)** (`operator/`)
   - `AgentDeployment` CRD → provisions a dedicated namespace with ResourceQuota, LimitRange,
     ServiceAccount, scoped RBAC, NetworkPolicy (default-deny egress + gateway allowlist)
   - `Schedule` and `Credential` CRDs
   - Reconciler with owner references + finalizers for clean teardown
   - Health-checked rollouts with auto-rollback (FR-12.6)

2. **Namespace-per-agent isolation working end-to-end**
   - Deploy surface provisions namespace via operator, not ad-hoc
   - Agent's coding-CLI node runs in its own namespace (pod-per-session on kind)

3. **Tool builder UI** (FR-6.1)
   - REST tool creation form with JMESPath response projection + live token meter
   - Tool_call node wired to the tool builder

4. **Knowledge/RAG in the UI** (FR-7.1)
   - Source upload (docs, URLs), chunking, keyword + vector search
   - Retrieval node config in the canvas

5. **Run trace waterfall in the UI** (FR-9.1)
   - Per-node span visualization: model, tokens, cost, latency
   - Run history list

6. **OIDC/SSO login** (FR-12.5)
   - Keycloak on kind; BFF pattern; scope-aware RBAC
   - Multi-tenant project/agent scoping

### Demo moment
> Log in. Build a customer-support agent: `trigger_api` → `retrieval` (product FAQ knowledge base)
> → `router` (intent classifier) → `agent` (answer) / `tool_call` (ticket creation) → `end`.
> Deploy it. It lands in its own namespace (`kubectl get ns` shows it). Hit its `/run` endpoint.
> It retrieves relevant docs, routes the query, and responds. View the trace waterfall showing
> cost per node.

### Exit criteria
- Operator reconciles AgentDeployment → real namespace with quota + network policy
- An agent deployed via the console runs isolated in its own namespace
- Run trace waterfall renders in the console with per-node cost
- OIDC login works; two users see only their own agents

---

## Phase 2 — Multi-Agent Workflows & Safety (weeks 8–12)

**Goal:** Build complex, multi-agent workflows with human approval gates, content guardrails, and
review panels. This is the "enterprise-ready" moment.

### What to build
1. **Human-in-the-loop approval in the UI** (§5.7)
   - Approver inbox in the console (pending decisions with badge)
   - Approve/reject flow with reason, mints authorization receipt
   - State-fingerprinted, expiring, single-use receipts

2. **Ensemble review nodes in the UI**
   - Jury node config: pick N models, set threshold (FR-8.1)
   - Adversarial debate node: attacker/defender, adaptive rounds (FR-8.2)
   - Pre-mortem node: stress-test a plan with severity verdicts (FR-8.3)

3. **A2A multi-agent handoff** (FR-13.3)
   - Handoff node: agent-to-agent collaboration across namespace boundaries
   - Capability discovery + task delegation

4. **Content guardrails in the UI** (FR-13.4)
   - Guardrail node config: regex, model-based moderation, custom webhooks
   - Gateway-level filtering visible in the run trace

5. **Circuit breaker** (FR-5.3)
   - Token-spiral detection with zero extra LLM calls
   - Auto-trip + failure classification + OTel attributes

6. **Legality runtime** (FR-5.1)
   - `inspect_move` vs `attempt_transition`
   - Gate/guard evaluation from explicit state + evidence TTL + receipts

7. **OAuth connector registry** (FR-6.3)
   - Google, Slack, GitHub, Jira connectors with OAuth flow
   - Credential store (encrypted at rest)

8. **More deploy surfaces**
   - Email channel (FR-10.1)
   - Scheduler/trigger config in the UI (FR-10.2)

### Demo moment
> Build a code-review workflow: `trigger_api` → `agent` (generate code) → `jury` (3-model review
> panel) → `adversarial_debate` (attacker finds bugs, defender justifies) → `quality_gate` (all
> reviewers pass?) → `approval` (human signs off) → `end`. Run it. The jury deliberates across
> three models. The debate runs two rounds. The quality gate blocks on a seeded bug. Fix it,
> re-run, the approval request appears in the inbox. Approve it. The run completes. Show the full
> trace with cost.

### Exit criteria
- Human approval flow works end-to-end: pause → inbox → approve/reject → resume
- Jury + adversarial debate + quality gate nodes function in a workflow
- Circuit breaker trips on a deliberately spiraling prompt
- OAuth connector (e.g. GitHub) works in a tool_call node

---

## Phase 3 — Self-Build Loop v0 (weeks 13–18)

**Goal:** Agent Studio builds itself. The "Meta Studio Dev" workflow plans, codes, reviews, and
merges a real change to Agent Studio's own repo — autonomously, gated by automated checks. This is
the differentiator demo.

### What to build
1. **Repo knowledge base** (FR-7.2)
   - AST-based code indexing + LLM interpretation
   - Hybrid BM25 + dense + reciprocal-rank-fusion + rerank
   - Incremental freshness (re-index on change)

2. **Containerized coding-CLI actors** (FR-4.3)
   - Actor base images for Claude Code (+ Codex, Aider stubs)
   - Common adapter: prompt → CLI session → structured output
   - Git worktree isolation per work item

3. **Meta Studio Dev workflow** (`workflows/agent-studio-dev.yaml`)
   - Intake → Plan (multi-model ensemble) → atomic work items
   - Per-item: Implement (coding CLI actor in worktree, iterative auto-fix loop)
   - Review (jury + adversarial_debate + premortem)
   - Verify (hard gates: build, test, lint, security scan)
   - Auto-merge on all-green
   - Deploy to canary namespace → health check → promote or rollback

4. **Governor node** (FR-8.7)
   - PI/PID regulation of autonomy aggressiveness
   - Hard safety floors (never regulates below)
   - Asymmetric ratchet (red gate → max stringency immediately)
   - Conservative seeding (max stringency until N clean merges)

5. **Canary namespace** (R2/R3)
   - Self-changes validate in canary before touching `agent-studio-system`
   - Health-check gate between canary and production

6. **Self-docs wiki** (`workflows/self-docs-wiki.yaml`)
   - `file:line`-cited documentation regenerated on each merge
   - Citation-linting as a gate
   - Guarded publish (refuses default branch, scans for secrets)

7. **Meta Studio dashboard in the console**
   - Live view of the self-build pipeline
   - Per-item status: planning → implementing → reviewing → verifying → merged/rejected
   - Governor state: current stringency, defect/rollback rate, trust level

### Demo moment
> Open Meta Studio in the console. File a task: "Add a `transform` node that applies a JMESPath
> expression to the state." The Dev workflow kicks off. Watch it plan the change, spin up a Claude
> Code actor in a sandboxed worktree, write the code, iterate on test failures, pass through a
> 3-model jury + adversarial debate, clear the build/test/lint/security gates, auto-merge to a
> branch, deploy to canary, health-check passes, promote to main. The self-docs wiki updates.
> The whole thing ran autonomously — no human clicked approve.

### Exit criteria
- A real feature is planned, coded, reviewed, merged, and deployed by the loop with zero human
  clicks
- A seeded bad change (failing test / security issue) is caught by a gate and blocked
- A bad deploy auto-rolls-back from the canary namespace
- Governor starts at max stringency and the dashboard shows the trust trajectory

---

## Phase 4 — Platform Breadth & Polish (weeks 19–24)

**Goal:** The platform handles real-world agent use cases end-to-end. External users can build
non-trivial agents, deploy them multiple ways, and manage them at scale.

### What to build
1. **Document → Skill ingestion** (FR-7.4)
   - Upload PDF/EPUB/DOCX/MD/HTML → structured, on-demand agent skills
   - Skill validator + lazy loading to save tokens

2. **Agent memory + nightly consolidation** (FR-7.5)
   - Persistent agent memory across sessions
   - Nightly distillation/consolidation job

3. **GraphQL + SQL tool types** (FR-6.1)
   - Tool builder supports GraphQL and SQL data sources

4. **MCP both ways** (FR-6.4)
   - Consume external MCP servers as tools
   - Expose any Agent Studio workflow as an MCP server
   - MCP gateway federation through agentgateway

5. **Generative UI** (FR-6.5)
   - Agent scaffolds a small data model + backend + UI from description
   - Rendered in sandboxed iframes, state-aware

6. **Multi-host export** (FR-10.4)
   - Export an agent as a plugin for Claude Code / Codex / Cursor ecosystems
   - Auto-detect host, package appropriately

7. **Design system polish**
   - Consistent light/dark theming across all surfaces
   - Responsive layout, keyboard shortcuts, accessibility
   - Onboarding flow for new users

8. **RAG self-tuner** (`workflows/rag-self-tuner.yaml`)
   - Optimizer node driving chunking/embedding params against F-beta eval set
   - Keep-or-discard: only metric-improving configs are kept

9. **Architecture deepening sweep** (`workflows/arch-deepening-sweep.yaml`)
   - Autonomous proposer + independent verifier (verifier never sees proposer reasoning)
   - Files ready-to-implement items for the Dev loop

### Demo moment
> An external user signs up. They upload a product manual (PDF), which gets ingested as a skill.
> They build a support agent on the canvas with retrieval + memory + tool_call (Jira ticket
> creation via OAuth). They deploy it three ways: as a `/run` API, an MCP server, and an
> embeddable chat widget. They paste the widget into their site. A customer chats with it — it
> remembers context across sessions, retrieves from the manual, and creates a Jira ticket. The
> user views cost analytics in the console. Meanwhile, Agent Studio's own RAG self-tuner has
> autonomously improved retrieval quality by 12% this week.

### Exit criteria
- Build a non-trivial external agent end-to-end and deploy it 3 ways into its own namespace
- Document → skill ingestion works for PDF and DOCX
- Agent memory persists across sessions and consolidates nightly
- RAG self-tuner ships an autonomous retrieval improvement (metric-gated)
- Two isolated agents run concurrently in separate namespaces with zero cross-contamination

---

## Phase 5 — Hardening & Certification Readiness (weeks 25–30)

**Goal:** Production-grade. Multi-tenant hardening, compliance controls, and the autonomous
crossover — a majority of Agent Studio's own PRs come from Meta Studio.

### What to build
1. **Multi-tenant hardening**
   - NetworkPolicy audit + tightening
   - ResourceQuota enforcement at scale
   - CEL-based fine-grained RBAC at the gateway
   - Cross-tenant isolation verification (chaos tests)

2. **Tamper-evident audit log** (§17.2)
   - Hash-chained append-only log covering all irreversible actions
   - Exportable; WORM-optional to object store

3. **Data retention + right-to-erasure** (§17.2)
   - Per-tenant retention policies
   - `data_subject_request` workflow (drop Tier-2 store = provable deletion)

4. **Compliance profiles** (§17.4)
   - `soc2` + `gdpr` profiles enforcing the baseline + deltas
   - Control traceability matrix in the repo (CI fails on gaps)
   - Evidence automation job

5. **Substrate integration hardening** (FR-12.3)
   - If Substrate is stable: enable snapshot suspend/resume on real clusters
   - Golden-snapshot ActorTemplates for coding CLIs
   - Sub-second resume benchmarking

6. **Performance + chaos testing**
   - Kill API pod mid-run → assert checkpoint resume + SSE replay
   - Concurrent agent load test (10+ agents, separate namespaces)
   - Gateway HA + failover testing

7. **Optional desktop shell** (FR-11.3)
   - Electron/Tauri wrapper around the web console
   - Local-first mode with embedded kind

### Demo moment
> Show the Meta Studio dashboard: "63% of this month's merged PRs were autonomously planned,
> coded, reviewed, and deployed by Agent Studio itself." Show the compliance dashboard: SOC 2
> control matrix is 100% green, every control has an automated test and evidence artifact. Show
> the audit log: every autonomous merge has a hash-chained receipt trail. Kill an API pod — the
> in-flight run resumes from checkpoint on another replica with zero lost SSE frames.

### Exit criteria
- ≥50% of Agent Studio's own merged PRs originate from Meta Studio (the crossover)
- SOC 2 + GDPR compliance profiles active with evidence automation
- Pod-kill chaos test passes: runs resume from checkpoint
- Sub-second actor resume demonstrated on a real cluster (if Substrate stable)
- Zero cross-namespace incidents in load testing

---

## Dependency graph (what blocks what)

```
Phase 0 (canvas + kind demo)
    │
    ├──► Phase 1 (operator + namespace isolation + UI)
    │        │
    │        ├──► Phase 2 (safety + multi-agent + connectors)
    │        │        │
    │        │        └──► Phase 3 (self-build loop)
    │        │                 │
    │        │                 ├──► Phase 4 (breadth + self-improvement)
    │        │                 │
    │        │                 └──► Phase 5 (hardening + compliance)
    │        │
    │        └──► Phase 4 (tool builder + knowledge can start in parallel)
    │
    └──► Phase 1 can start backend work in parallel with canvas polish
```

---

## Key risks per phase

| Phase | Risk | Mitigation |
|-------|------|------------|
| 0 | Canvas library choice delays | Timebox to 3 days; React Flow is the safe default |
| 1 | Operator complexity (kubebuilder learning curve) | Start with AgentDeployment only; Schedule/Credential CRDs in Phase 2 |
| 2 | Multi-agent coordination complexity | A2A mesh can be simplified to HTTP handoffs initially |
| 3 | Self-build loop produces bad code | Conservative governor seeding + canary namespace + human override always available |
| 3 | Coding CLI actors are flaky | Pod-per-session fallback via RuntimePort; density is an optimization |
| 4 | Scope creep from breadth features | Feature-flag everything; ship incrementally |
| 5 | Substrate not production-ready | Runtime port abstracts it; pod-per-session is always available |
| 5 | Compliance certification timeline | Technical controls ship in Phase 5; actual audit is operator-driven, 3–12 month window |

---

## What to show customers at each phase

| Phase | Customer story |
|-------|---------------|
| **0** | "Here's a visual canvas where you drag-and-drop AI agents. It runs on Kubernetes locally." |
| **1** | "Each agent you build gets its own isolated namespace. Here's a real agent answering questions from a knowledge base." |
| **2** | "Enterprise safety: human approvals, multi-model review panels, content guardrails, and cost controls." |
| **3** | "The platform builds itself. Watch it autonomously plan, code, review, and ship a feature." |
| **4** | "Build any agent: upload docs, connect tools, deploy as API / widget / MCP server. Memory across sessions." |
| **5** | "Production-grade: SOC 2 ready, auto-rollback, chaos-tested, and >50% of our own PRs are self-authored." |
