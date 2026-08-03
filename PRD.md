# Agent Studio — Product Requirements Document

> **Agent Studio** is an open-source platform for building AI agents and multi-agent workflows
> **visually** on a canvas, running on **Kubernetes** — each agent is deployed into its own
> isolated namespace, and coding work executes in **containerized coding CLIs** as suspend/resumable
> sandboxes on a high-density runtime. Its defining trait is that **it builds itself, fully
> autonomously**: Agent Studio ships agent workflows, authored inside Agent Studio, whose target repository is Agent Studio's
> own codebase. You use the product to extend the product.

- **Name:** Agent Studio (working name; see §15-Q3). Sits *above* the two integrated subsystems it
  deploys on — **Agent Substrate** (sandbox runtime) and **agentgateway** (connectivity fabric).
- **Status:** Draft v0.5 (PRD only — no implementation yet)
- **Author:** Platform team
- **Date:** 2026-08-02
- **License intent:** Apache-2.0 core (see §13)

### Directly-integrated systems vs native capabilities
Agent Studio **directly deploys and integrates two external systems**, named throughout this document:
- **Agent Substrate** (`substrate`) — the high-density agent **sandbox runtime** (§7.12).
- **agentgateway** — the **connectivity data plane** for agent↔LLM, agent↔tool, and agent↔agent
  traffic (§7.13).

**Every other capability described here is built natively in Agent Studio.** Where a feature was informed by
existing implementations, the code is reimplemented/adapted into Agent Studio's own codebase; this PRD
describes the *functionality*, not its provenance.

### Locked decisions (v0.4)
1. **Web-first.** A Next.js/React web console is the primary surface. A desktop build is a later,
   optional track.
2. **Full autonomy.** The self-build loop executes end-to-end autonomously (plan → code → review →
   verify → merge → deploy). Safety comes from **automated gates + guardrails** (tests, ensemble/
   adversarial review, transition legality, circuit breakers, auto-rollback), not a mandatory human
   click. A human approval gate is *configurable per workflow* and off by default for trusted self-build
   tasks.
3. **Kubernetes is the substrate.** The whole platform and every agent it builds run on Kubernetes.
   **Each agent/workflow is deployed into its own namespace** with isolated compute, quotas, RBAC, and
   network policy. Multi-tenant is foundational, not a later add-on.
4. **Containerized coding CLIs on a high-density snapshot runtime.** Node execution — especially the
   self-build coding work — runs already-authenticated coding CLIs (Claude Code, Codex, Cursor, Aider,
   Gemini CLI) as sandboxed **actors on Agent Substrate**, not in the control-plane process. Instead of
   a cold pod per session, Substrate multiplexes many suspend/resumable actors onto a warm pool of
   gVisor/microVM workers, resuming in **sub-second** time with full RAM + filesystem state preserved
   (terminal + git worktree survive idle).

---

## 1. Summary

Building a production agent today means writing framework code, then wiring model providers, tools,
retrieval, memory, guardrails, evaluation, and deployment by hand — and rebuilding all of it for the
next agent. Agent Studio turns that into visual assembly on a canvas, backed by a declarative spec that
compiles to an executable graph, and runs the result at scale on Kubernetes.

Agent Studio's differentiator is that the platform is **self-hosting**: the same canvas, node catalog, runtime,
and deploy surfaces a user uses to build a customer-support agent are used to plan, code, review,
document, and ship changes to Agent Studio itself — fully autonomously. The "Meta Studio" is a first-class,
shipped part of the product, not a side script.

This PRD defines the product, users, scope, the visual builder and node catalog, the runtime and deploy
surfaces, the Kubernetes substrate, the two integrated external systems (Agent Substrate and
agentgateway), the autonomous self-build mechanism, and the architecture, milestones, NFRs, licensing,
and risks.

---

## 2. Problem & motivation

**For agent builders (primary):** Framework-code agents are slow to author, hard to observe, and
impossible for non-engineers to touch. Every capability — retrieval, memory, human-in-the-loop
approval, multi-model review, cost guards — is a from-scratch integration.

**For platform maintainers (the self-build case):** Agent platforms are large, fast-moving codebases.
Maintaining one by hand doesn't scale. If the platform is any good at orchestrating agents to do
software work, it should orchestrate agents to work on *itself* — turning every internal task (a bug, a
new node type, a doc refresh) into a planned, reviewed, agent-executed, deployed change.

**The gap:** No single tool gives you (a) a genuinely visual builder, (b) a production runtime with
safety, observability, connectivity, and deploy built in, and (c) a self-hosting loop where the platform
improves itself. Agent Studio composes all three.

---

## 3. Goals & non-goals

### Goals
1. **Visual-first authoring.** A drag-and-drop canvas where a user wires agents, tools, knowledge,
   memory, control-flow, review, and guardrail nodes into a runnable workflow — no framework code.
2. **Declarative, compilable spec.** Every workflow is a versioned JSON/YAML document that compiles
   deterministically to an executable graph. The editor is a view over the spec; the spec is the truth.
3. **Any model, any provider, per node.** Route each node to its own provider/model with fallbacks,
   BYOK, encrypted at rest, editable at runtime — reached through one governed model endpoint.
4. **Safe by default.** Tool sandboxing/attribution, egress governance, human-in-the-loop approvals with
   single-use authorization, token-spiral circuit breakers, transition-legality enforcement, content
   guardrails.
5. **Observable by default.** Every run is a span waterfall with per-node model/time/cost, exportable to
   OpenTelemetry; failures are classified with suggested fixes.
6. **Deploy anywhere.** Ship a workflow as an HTTP `/run` API, an MCP server, an embeddable chat widget,
   an email channel, or a scheduled/triggered job.
7. **Self-hosting, fully autonomous.** Agent Studio ships "Meta Studio" workflows that autonomously plan →
   implement → review → verify → merge → deploy changes against Agent Studio's own repo, gated by automated
   checks rather than mandatory human approval (§6, §12).
8. **Kubernetes-native multi-tenancy.** The platform and every agent it builds run on Kubernetes. **Each
   agent/workflow is isolated in its own namespace** (compute, quota, RBAC, network policy); coding work
   runs in **containerized coding CLIs** as suspend/resumable actors on **Agent Substrate** (§7.12); all
   agent traffic flows through **agentgateway** (§7.13).

### Non-goals (v1)
- Not a general no-code app builder; it builds **agents/workflows**, though agents may generate their
  own UIs (generative UI, §7.6).
- Not tied to one agent CLI or one model vendor.
- Not a non-Kubernetes product. A single-node/local dev mode exists for authoring, but the target
  runtime is Kubernetes; no serverless or bare-VM production path is committed in v1.
- No proprietary/closed license; no Elastic-/source-available-encumbered runtime dependencies in the
  core (§13).

---

## 4. Users & personas

| Persona | Needs | Primary surfaces |
|---|---|---|
| **Agent Builder** (semi-technical PM, ops, solutions eng) | Assemble a working agent from blocks, test it, ship it | Canvas, node config forms, playground, deploy |
| **Platform Engineer** | Author custom tools/nodes, run at scale, integrate CI/secrets | Tool builder, spec/YAML, API, RBAC, observability |
| **Agent Studio Maintainer** (dogfood user) | Turn an issue into a reviewed, deployed change to Agent Studio | Meta Studio workflows, ensemble/adversarial review, self-docs |
| **Agent Studio itself** (autonomous) | Execute tasks against its own repo | Scheduler/triggers → Meta Studio → sandboxed actor → merge → deploy |
| **End user of a shipped agent** | Chat with / call the deployed agent | Embeddable widget, API, email |

---

## 5. Key concepts & terminology

- **Workflow** — a directed graph of **nodes** and **edges**; the unit a user builds, versions, runs,
  and deploys.
- **Node** — a typed building block (agent, tool_call, router, retrieval, jury, guardrail, human_input,
  subworkflow, trigger, …). Defined by a JSON Schema; see §9.
- **Spec** — the declarative JSON/YAML document for a workflow. Canvas ⇄ Spec are two views of one truth.
- **Compiler** — turns a spec into an executable graph.
- **Runtime** — executes a compiled graph: streaming, checkpointing, human-in-the-loop pauses, safety
  guards.
- **Run** — one execution of a workflow, captured as a span waterfall with cost/latency per node.
- **Middleware** — declarative per-agent behaviors (PII redaction, retries, model fallback, context
  editing) compiled onto an agent node.
- **Connector** — an OAuth-capable external integration (Google, Slack, Notion, GitHub…).
- **Skill** — a structured, on-demand knowledge asset an agent can load.
- **Actor** — a Substrate sandbox instance running one session; suspend/resumable (§7.12).
- **Meta Studio** — the shipped collection of Agent Studio-authored workflows that operate on Agent Studio's own repo.
- **Legality** — the runtime's decision about whether a proposed transition/tool-call is permitted.

---

## 6. The self-build thesis (the differentiator)

Agent Studio "builds itself" in three concrete, testable senses. All three are shipped features, expressed as
**workflows authored inside Agent Studio** and stored in the repo.

### 6.1 Self-development (the core loop — fully autonomous)
A prebuilt **"Agent Studio Dev" workflow** turns a natural-language task or a linked issue into merged, deployed
changes **against Agent Studio's own repository**, end-to-end, with no mandatory human click:

```
Intake → Plan (multi-model planning ensemble → PRD → atomic work items)
      → per-item: Implement  ── runs as a Substrate actor: containerized coding CLI
      │                          in an isolated git worktree, iterative auto-fix loop
      │                          (suspends between gate waits, resumes sub-second)
      → Review (ensemble judge panel + adversarial attacker/defender debate + pre-mortem critic)
      → Verify (build/tests/lints/security as HARD gates — a red gate blocks the merge)
      → Merge (auto, on all-green)  → Deploy (rollout to namespace, auto-rollback on failure)
      → Docs (source-cited wiki refresh)
```

**Autonomy model:** progression is controlled by **automated gates**, not a human approval step. The
loop advances only when every gate is green (tests pass, ensemble review ≥ threshold, adversarial debate
finds no confirmed blocker, security scan clean, budget respected). Any red gate stops that item and
routes it back to Implement (bounded revise loop). A failed post-merge deploy **auto-rolls-back**. A
human approval gate remains *available* per workflow (§7.5 authorization receipts) but is **off by
default** for trusted self-build tasks. Guardrails — legality runtime, token circuit breaker, per-tool
policy, budget ceilings — are always on and can hard-stop a run.

Every stage runs on Agent Studio's own runtime and node catalog — nothing bespoke. Coding actors run on **Agent
Substrate**; all model/tool/agent traffic flows through **agentgateway**.

### 6.2 Self-improvement
- **Retrieval tuning:** a keep-or-discard optimization loop (the `optimizer` node, FR-8.6) tunes Agent Studio's own
  RAG (chunking/embeddings) against an F-beta eval set, keeping a change only when the metric improves.
- **Architecture deepening:** an autonomous sweep proposes vertical-slice refactors with an independent
  verifier (the verifier never sees the proposer's reasoning), filed as ready-to-implement items for the
  Dev loop.

### 6.3 Self-documentation
- A workflow regenerates Agent Studio's own wiki where **every claim cites `file:line`**, rebuilt on each merge,
  with citation-linting as a gate. Agent Studio's docs are themselves an Agent Studio workflow output.

**Bootstrapping order matters.** Agent Studio cannot build itself on day zero. §12 defines the phased handoff:
humans build the M0 core by hand; from M1 the Meta Studio workflows take over a growing share of Agent Studio's
own backlog, autonomously, as the automated gates earn trust.

**Guardrails on autonomy (always-on, non-negotiable):** autonomy is bounded by *automated* controls, not
a human in the loop. The self-build loop runs in isolated worktrees inside sandboxed actors (no access
to the control-plane host), advances only through green hard-gates, respects budget ceilings and the
token circuit breaker, is subject to the legality runtime and per-tool policy (§7.5), and
**auto-rolls-back** any deploy that fails its health check. Irreversible actions are recorded as
authorization receipts for audit; the *issuer* is the automated gate by default, and a human when a
workflow opts into manual approval.

---

## 7. Functional requirements (by capability)

### 7.1 Visual builder & canvas
- **FR-1.1** Drag-and-drop node-graph canvas with node palette, config side-panel, edge routing, and a
  live test panel.
- **FR-1.2** **DAG validation before run** (detect cycles, broken edges, unreachable nodes) with inline
  errors on the canvas, plus reachability analysis.
- **FR-1.3** Cohesive design system (a light warm-neutral theme and a dark charcoal theme, tonal depth).
- **FR-1.4** Spec ⇄ canvas round-trip: editing YAML/JSON updates the canvas and vice-versa.

### 7.2 Declarative spec, node schema & compiler
- **FR-2.1** A **JSON-Schema-defined node catalog** (§9) is the contract between UI, spec, and runtime.
- **FR-2.2** A **compiler** turns a spec into an executable stateful graph, handling router conditional
  edges, value→target branches, and expression-guarded routing, over a typed state schema with a small
  safe expression evaluator.
- **FR-2.3** Optional **YAML agent-spec** path for code-first users, compiling to the same runtime, with
  an orchestrator that routes each request to a focused sub-agent.
- **FR-2.4** **Declarative middleware stack** on agent nodes (PII redaction, human-in-the-loop, model
  fallback/retry, tool selection, context editing, call limits); adding one = a schema entry + a builder
  entry.

### 7.3 Runtime, execution & orchestration
- **FR-3.1** Streaming run execution over SSE (`run`/`node_start`/`messages`/`done` frames).
- **FR-3.2** **Topological-layer parallelism** — independent nodes in the same layer run concurrently.
- **FR-3.3** **Durable, resumable runs** — checkpoint/replay, resume after a human-in-the-loop pause,
  with explicit handoff artifacts between nodes.
- **FR-3.4** **State-outside-the-model** orchestration with human approval gates modeled as explicit
  state machines and bounded-revise loops (an errored reviewer = INCONCLUSIVE, never a silent pass).
- **FR-3.5** **Structured-output repair** when a model returns malformed JSON/YAML.
- **FR-3.6** **Distributed node execution on Kubernetes.** The control plane compiles the graph; heavy or
  untrusted nodes (agent, containerized-CLI, code tools) execute in **sandboxed actors** (§7.12)
  scheduled into the workflow's namespace, streaming execution events back to the control plane over SSE.
  The runner reconciles desired-vs-actual session state (GitOps reconciler loop), not fire-and-forget.
- **FR-3.7** **Checkpoint/replay across sandbox boundaries.** A run's durable state (checkpoints, handoff
  artifacts) lives in the control plane so a session sandbox can die and be rescheduled without losing
  progress; human-in-the-loop pauses survive restarts.

### 7.4 Models, providers & agent backends
- **FR-4.1** **Provider registry keyed by *kind*** (`openai` | `anthropic` | `claude-cli` | …), not
  guessed from model name; per-node provider+model selection, live-editable, keys encrypted at rest.
  Selection resolves to a route on the governed model endpoint (§7.13).
- **FR-4.2** Broad provider matrix (OpenAI, Anthropic, Bedrock, Google, and more, plus local model
  servers) + prompt caching + model discovery — reached through one OpenAI-compatible gateway endpoint.
- **FR-4.3** **Containerized agent-CLI backends** — run nodes on already-authenticated coding CLIs
  (Claude Code, Codex, Cursor, Aider, Gemini CLI) via a common adapter, each executing inside a sandboxed
  **Substrate actor** (gVisor/microVM) on a warm pool in the workflow's namespace/atespace (§7.12). CLI
  auth is minted at the connectivity fabric / injected via a credential sidecar so the CLI never holds
  raw long-lived secrets; the actor has no access to the control-plane host and suspends to a snapshot
  between events. This is the default execution mode for the self-build loop.
- **FR-4.4** **Per-node model + fallback list** as config.

### 7.5 Safety, guardrails & legality
- **FR-5.1** **Transition-legality runtime** — the model proposes moves; the runtime decides legality
  from explicit state, evidence TTL, gates/guards, and human authorization. Non-mutating `inspect_move`
  vs mutating `attempt_transition`.
- **FR-5.2** **Authorization receipts** — a human (or an automated gate) approval bound to one transition
  + exact state fingerprint + expiry + single-use. Gates every irreversible action
  (merge/deploy/spend), backed by a full human-in-the-loop approvals subsystem (coordinator, policy,
  decision, session store, sanitization, identity).
- **FR-5.3** **Token-spiral circuit breaker** — detect context spirals / retry storms / policy drift via
  an energy-function monitor with **zero extra LLM calls**; trip and classify the failure with suggested
  fixes; export OTel attributes. Ships as an in-actor sidecar (optional native wheel or pure-Python
  guard).
- **FR-5.4** **Per-tool runtime attribution & policy enforcement** — attribute file/exec/socket actions
  to the exact tool call; allow/deny per tool (fs/exec/network) with a YAML policy; structured audit
  schema. The kernel-level (eBPF) attribution runs inside the sandboxed actor where we control the base
  image; the policy schema + audit format are required, the eBPF core is Linux-only.
- **FR-5.5** **Egress governance.** Outbound tool/model/agent traffic is governed at the connectivity
  fabric (§7.13, egress + CEL policy); an in-process SSRF guard remains a defense-in-depth fallback for
  local/standalone mode.

### 7.6 Tools, connectors & generative UI
- **FR-6.1** **Tool builder** for REST, GraphQL, SQL, `code`, MCP, and builtin tools, with **JMESPath
  response projection** (trim payloads before the model sees them, with a live token meter).
- **FR-6.2** **Sandboxed code tools** (AST-restricted execution as a hardening layer).
- **FR-6.3** **OAuth connector registry** (Google Workspace, Slack, Notion, GitHub, Zoom, Discord,
  Telegram, Jira…) with a credentials store and OAuth flow — a connector marketplace.
- **FR-6.4** **MCP both ways** — consume external MCP servers as tools *and* expose any Agent Studio workflow as
  an MCP server. Tool traffic is federated/authenticated through the **MCP gateway** (§7.13) rather than
  each actor dialing servers directly; an in-process MCP client remains the local/standalone path.
- **FR-6.5** **Generative UI** (advanced) — an agent can scaffold a small data model + backend + UI from
  a plain-language description and stay state-aware of it, rendered in sandboxed iframes.
- **FR-6.6** **Credential handling** — model/tool/agent credentials are minted at the connectivity fabric
  (§7.13 token-exchange) so actors hold no provider secrets on the LLM/MCP/A2A path; per-provider
  **credential sidecars** cover non-gateway integrations (e.g. a coding CLI's own git/host auth). Secrets
  never reach model context, snapshots, or logs.

### 7.7 Knowledge, memory & skills
- **FR-7.1** **Knowledge/RAG module** — crawl, split, embed, hybrid search, rerank, pgvector store;
  offline-capable by default (embedded vector store in dev → Postgres+pgvector in prod).
- **FR-7.2** **Repo knowledge base** — static-analysis facts (AST) + LLM interpretation + incremental
  freshness; hybrid BM25 + dense + reciprocal-rank-fusion + rerank over a code graph. (Powers self-build.)
- **FR-7.3** **RAG self-eval loop** — synthetic eval-set generation + F-beta scoring + keep-or-discard.
- **FR-7.4** **Document → Skill ingestion** — turn uploaded PDFs/EPUB/DOCX/MD/HTML into structured,
  on-demand agent skills, loaded lazily to save tokens, with a skill validator.
- **FR-7.5** **Agent memory + nightly consolidation** — a file-based memory/identity/mission substrate;
  nightly distillation/consolidation of the day's events.

### 7.8 Multi-agent review, evaluation & quality gates
- **FR-8.1** **Jury node** — an ensemble of independent, differently-modeled judges + a synthesizing
  arbiter evaluates an artifact (code, answer, plan).
- **FR-8.2** **Adversarial debate node** — two independent sub-agents argue (attacker vs defender) across
  adaptive rounds with convergence detection; a concession = a confirmed issue.
- **FR-8.3** **Pre-mortem / devil's-advocate node** — stress-tests a plan with severity-rated verdicts
  and explicit scope/delegation.
- **FR-8.4** **Hard quality-gate pipeline** — configurable gates (citations verified against ≥2 sources,
  statistical/AI-text audits, all reviewers pass) with bounded revision loops.
- **FR-8.5** **Propose/verify separation** — the verifier never sees the proposer's reasoning, only its
  claims.
- **FR-8.6** **Closed-loop parameter optimizer** — an `optimizer` node that tunes a declared set of numeric
  parameters against an eval objective, closing the loop the way a control-design tool tunes a controller:
  an LLM translates a natural-language performance goal ("higher recall, don't blow the latency budget")
  into **quantitative targets + weights**, a black-box search (evolutionary — particle-swarm /
  differential-evolution — or Bayesian) iterates against a **replayable or simulatable evaluator**, and only
  a metric-improving configuration is kept (keep-or-discard). Generalizes the RAG self-tuner (§6.2, FR-7.3)
  to any tunable config — retrieval params, agent-middleware retry/temperature, router thresholds, budget
  dials. Objective, parameter bounds, and search budget are declarative; each tuning run is a normal span
  waterfall with per-trial cost (§7.9), and the winning config is written back as a versioned spec change.
- **FR-8.7** **Self-build process controller** — **online, continuous** regulation of the autonomous
  self-build loop (§6, §12) treated as a time series over many runs — the complement to the **offline,
  episodic** `optimizer` (FR-8.6). A `controller` node holds a quality/safety **setpoint** (target
  escaped-defect / rollback rate) against the **measured recent rate**, and drives an **actuator**: autonomy
  aggressiveness (share of backlog auto-merged) and review-stringency thresholds. Realized as a filtered
  **PI/PID** controller with three non-negotiable domain constraints:
  - **(a) Hard safety floors.** Security, test, and legality gates (§7.5) are always-on and **never**
    regulated; the controller moves only within a bounded stringency range *above* the floor — it can never
    disable a gate.
  - **(b) Asymmetric response.** Trust extends slowly, but any red safety gate, failed deploy, or
    auto-rollback (§12.6, §6.1) **snaps stringency to max immediately** (a ratchet, not a symmetric linear
    law).
  - **(c) Dead-time aware.** Defect/rollback feedback lags the merge that caused it, so the error signal is
    **EWMA-filtered**, the integral term is **windup-clamped**, and the derivative term is used only as a
    debounced trend signal (raw D on sparse defect data is noise).

  This operationalizes the §12 trust ramp as a **closed loop** rather than a manual dial, and is itself a
  guardrailed, kill-switchable workflow like any other.

### 7.9 Observability, cost & evaluation
- **FR-9.1** Every run is a **span waterfall** with per-node model/time/**cost**, exportable to
  OpenTelemetry; budgets and quotas enforced. **Authoritative token/spend data comes from the
  connectivity fabric** (§7.13), where every LLM/tool/agent hop is metered and budgets enforced on the
  wire; the app-level meter reconciles against it. Includes semantic cache and evals services.
- **FR-9.2** **Failure classification** with evidence, cost estimate, and suggested actions;
  OTel/CSV/JSON export.
- **FR-9.3** **Session/SessionEvent data model** — human-readable message stream + compressed,
  replayable event stream.

### 7.10 Deploy surfaces & distribution
- **FR-10.1** Deploy a workflow as: **HTTP `/run` API** (with human-in-the-loop resume), **MCP server**,
  **embeddable chat widget**, **email channel**, and **scheduled/triggered** job.
- **FR-10.2** **Proactivity & triggers** — scheduler, event triggers, session auto-route (new vs resume),
  rate limiting.
- **FR-10.3** **Ambient/observer agents** — always-loaded agents that read along and speak up (via a
  session-start hook), with a persistent persona overlay.
- **FR-10.4** **Multi-host export & plugin packaging** — export an Agent Studio agent/skill to popular coding-CLI
  ecosystems and publish as a plugin/marketplace entry (auto-detecting the host).

### 7.11 Docs, demos & desktop packaging
- **FR-11.1** **Source-cited self-documentation** — regenerate a `file:line`-cited wiki on each merge,
  with citation-linting and guarded publish (refuses default branch, scans for secrets).
- **FR-11.2** **Workflow-as-slides export** (optional) — render a workflow/run walkthrough as an animated
  code/step deck for demos and onboarding.
- **FR-11.3** **Optional desktop app** — a desktop shell for local-first use.

### 7.12 Deployment substrate: Kubernetes, per-agent namespaces, high-density runtime — *integrates: Agent Substrate*

**Two complementary layers.** Agent Studio's own **control plane** is the multi-tenant product layer (projects,
sessions, GitOps reconciliation, credential handling, RBAC/SSO) — it decides *what* agents exist and
*who* may touch them. **Agent Substrate** is the low-opinion, high-density execution runtime underneath —
it decides *how* each session sandbox physically runs, suspends, resumes, and multiplexes onto workers.
Agent Studio composes them: control-plane orchestration on top, Substrate sandbox runtime below.

- **FR-12.1** **Namespace-per-agent isolation.** Deploying a workflow/agent provisions a dedicated
  Kubernetes **namespace** carrying its compute, `ResourceQuota`/`LimitRange`, `ServiceAccount`, scoped
  RBAC, and `NetworkPolicy` (default-deny egress + allowlist to the gateway). One agent's blast radius
  never reaches another's.
- **FR-12.2** **GitOps reconciler control loop.** Agents, credentials, schedules, and deployments are
  declared as desired state (Git / CRDs); an operator reconciles idempotently (reconcile-don't-create)
  and streams status via watch informers. The workflow spec (§7.2) is the desired state.
- **FR-12.3** **Actor-per-session on a high-density snapshot runtime (Agent Substrate).** Each agent/CLI
  run is a Substrate **Actor** (kernel-isolated via gVisor/microVM) multiplexed onto a warm **WorkerPool**
  rather than a cold pod-per-session. Idle actors **suspend to a snapshot** (RAM + filesystem, incl.
  terminal + git worktree) and **resume in sub-second** time on the next event — ideal for self-build
  sessions that idle waiting on reviews/gates/human input. Actors are addressed by `(atespace, name)`;
  an **agent-aware router** resumes a suspended actor on incoming traffic.
  - *Substrate components:* `ate-api-server` (actor lifecycle + scheduling), `atecontroller` (CRDs
    `ActorTemplate`/`WorkerPool`/`SandboxConfig`), `atelet` (node supervisor + snapshot streaming),
    `ateom` (in-pod sandbox coordinator, gVisor/microVM), `atenet` (DNS + resume-on-traffic router),
    `podcertcontroller` (mTLS). Snapshot object store + in-memory state store.
  - *Defense-in-depth inside the actor:* per-tool eBPF attribution/enforcement + token-spiral guard
    sidecar (§7.5).
- **FR-12.4** **Credential handling — gateway token-exchange first, sidecars for the rest** (see FR-6.6).
- **FR-12.5** **AuthN/Z & multi-tenancy.** SSO via OIDC (e.g. Keycloak, dual-issuer), BFF pattern in the
  web console, scope-aware RBAC across tenant→agent→session→credential.
- **FR-12.6** **Rollout & auto-rollback.** Deploys are health-checked rollouts into the target namespace;
  a failed health check auto-rolls-back and reports (feeds the self-build deploy gate, §6.1).
- **FR-12.7** **Local dev mode.** For authoring without a cluster, the same control plane runs single-node
  against a local container runtime (e.g. `kind`/`minikube`), degrading namespaces to labels; the spec and
  compiler are identical so a workflow authored locally deploys unchanged to Kubernetes.
- **FR-12.8** **Isolation ⋈ density mapping (the key reconciliation).** "Each agent in its own namespace"
  and Substrate's "multiplex many actors onto few workers" are reconciled on three axes: an Agent Studio
  tenant/agent maps to **(a)** its own Kubernetes **namespace** (RBAC / NetworkPolicy / ResourceQuota
  boundary), **(b)** its own Substrate **Atespace** (actor identity/isolation boundary), and **(c)** a
  **WorkerPool** whose sharing scope is a policy dial: *dedicated pool per namespace* (strict isolation,
  lower density) up to *shared pool within a trust tier* (max density; gVisor gives per-actor kernel
  isolation, and **cross-tenant actors never share a worker**). Default: dedicated (or per-trust-tier)
  WorkerPool per tenant; the self-build/Meta-Studio tenant gets its own pool.
- **FR-12.9** **Coding-CLI images as immutable ActorTemplates (golden snapshots).** Each coding-CLI/base
  image is published as an immutable `ActorTemplate` that bakes a **golden snapshot** for fast
  first-resume; a new version = a new template (never edit in place). This dovetails with the self-build
  image pipeline (§15-Q8) — Agent Studio rebuilding its own actor images is a gated `ActorTemplate` bump.
- **FR-12.10** **State locality & durability.** Actor snapshots (frequently updated) live in
  snapshot/state stores separate from etcd; the runtime tracks where an actor's latest state is and
  routes/moves accordingly. Agent Studio treats snapshot storage as a first-class, backed-up dependency and
  reconciles it with the control plane's own durable run state (checkpoints/handoffs, FR-3.7).

### 7.13 Connectivity fabric & agent mesh — *integrates: agentgateway*
All traffic between an agent/actor and the outside world — LLMs, tools, and other agents — flows through
**agentgateway**, a governed data-plane proxy built on the AI-native protocols **MCP** (tools) and **A2A**
(agent-to-agent). It is the single enforcement point for budgets, auth, guardrails, and observability on
the wire, and it replaces several pieces Agent Studio would otherwise hand-roll. It runs as a Gateway-API-driven
proxy on Kubernetes (per-tenant or per-trust-tier), integrating with the Substrate runtime and control
plane.

- **FR-13.1** **LLM gateway (the model proxy — resolves §15-Q9).** Actors reach *all* model providers
  through one **OpenAI-compatible endpoint** with centralized **budget/spend controls**, load balancing,
  failover, prompt enrichment, and semantic routing. Per-node model selection (FR-4.1) resolves to a
  gateway route; the actor never holds provider API keys.
- **FR-13.2** **MCP gateway (realizes FR-6.4).** Federate many MCP servers behind one endpoint; expose
  OpenAPI services as MCP tools; multiplex; enforce OAuth-based tool authentication/authorization;
  support stdio/HTTP/SSE/Streamable transports. The Tool Builder registers tools *through* the MCP
  gateway.
- **FR-13.3** **A2A agent mesh (elevates the `handoff` node to a protocol).** Isolated agents (each in
  its own namespace/atespace) collaborate over **A2A** — capability discovery, modality negotiation, task
  collaboration — so multi-agent workflows and cross-agent handoffs work across isolation boundaries
  without hand-punching NetworkPolicy holes.
- **FR-13.4** **Guardrails (augments §7.5 with content filtering).** Multi-layer request/response
  filtering — regex, model-based moderation, managed guardrail services, custom webhooks — applied at the
  gateway, independent of the agent's own prompt.
- **FR-13.5** **Edge auth, RBAC & rate limiting.** JWT / API-key / OAuth auth, **CEL-based fine-grained
  RBAC**, global/local rate limiting, TLS + **HBONE mTLS** between hops, and **token exchange** so
  short-lived scoped creds are minted at the gateway (the cleaner realization of FR-6.6/FR-12.4).
- **FR-13.6** **Wire-level observability.** OpenTelemetry metrics/logs/traces for every LLM/tool/agent
  hop, feeding the span waterfall and cost meter (FR-9.1) with authoritative on-the-wire token/spend data.
- **FR-13.7** **Kubernetes-native deployment.** Deploy via agentgateway's built-in Go controller +
  **Gateway API**; a standalone flat-YAML mode exists for local dev (matches FR-12.7).

---

## 8. System architecture

**Shape (v1): web-first control plane on Kubernetes; every agent isolated in its own namespace + Atespace;
session execution as suspend/resumable actors on Agent Substrate; all agent traffic through
agentgateway.** The control plane (compiler + runtime + orchestration + provider registry + safety +
observability) is native Agent Studio. It integrates two external systems: **Agent Substrate** as the sandbox
runtime and **agentgateway** as the connectivity fabric. Native performance/safety guards run as in-actor
sidecars. A desktop build and a full-native-engine track remain later options.

The system splits into a **control plane** (one, cluster-scoped), a **Substrate runtime** (warm worker
pools), an **agentgateway data plane** (all outbound agent traffic), and **many per-agent isolation
boundaries** (namespace + Atespace):

```
                         ┌───────────── Kubernetes cluster ─────────────┐
┌──────────────────────┐ │  ┌────────────────────────────────────────┐ │
│  WEB CONSOLE (BFF)   │ │  │  CONTROL PLANE  ns: agent-studio-system  │ │
│  Next.js · React ·   │◄──►│  API (FastAPI): workflows·runs(SSE)·     │ │
│  node-graph canvas · │ │  │    tools·knowledge·connectors·deploy·    │ │
│  Meta Studio · embed │ │  │    traces·meta-studio                    │ │
│  OIDC/SSO (BFF)      │ │  │  COMPILER  spec → executable graph        │ │
└──────────────────────┘ │  │  + middleware compiler                   │ │
                          │  │  ORCHESTRATOR / RUNTIME                   │ │
                          │  │   scheduling · checkpoint/replay ·       │ │
                          │  │   HITL pause · topo-layer parallelism    │ │
                          │  │  GitOps RECONCILER (operator/CRDs)  ─────┼─┐
                          │  │  Provider registry (kind-keyed, BYOK)    │ │ │ provisions +
                          │  │  SAFETY: legality · authz receipts ·     │ │ │ reconciles
                          │  │   circuit breaker · tool-policy          │ │ │ namespaces
                          │  │  OBSERVABILITY: span waterfall · cost ·  │ │ │
                          │  │   OTel · session/event model             │ │ │
                          │  │  STORAGE: Postgres + pgvector + Redis    │ │ │
                          │  │   (dev: SQLite + embedded vector store)  │ │ │
                          │  └────────────────────────────────────────┘ │ │
                          │                                              │ │
                          │  ┌── AGENT SUBSTRATE runtime ───────────────┐│◄┘
                          │  │ ate-api-server (actor lifecycle/schedule)││ dispatch actor
                          │  │ atecontroller (CRDs: ActorTemplate ·     ││ (atespace,name)
                          │  │   WorkerPool · SandboxConfig)            ││
                          │  │ atenet (DNS + resume-on-traffic router)  ││
                          │  │ atelet (DaemonSet: snapshot stream)      ││
                          │  │ snapshot object store · state store      ││
                          │  │                                          ││
                          │  │ WorkerPool (warm gVisor/microVM workers) ││
                          │  │  ┌ worker ┐ ┌ worker ┐ ┌ worker ┐        ││
                          │  │  │ ACTOR  │ │ ACTOR  │ │ (idle, │  ...    ││
                          │  │  │ agent-A│ │ agent-B│ │ warm)  │        ││
                          │  │  │ coding │ │ coding │ └────────┘        ││
                          │  │  │ CLI +  │ │ CLI +  │  many suspended   ││
                          │  │  │worktree│ │worktree│  actors multiplex ││
                          │  │  └────────┘ └────────┘  (sub-sec resume) ││
                          │  └──────────────────────────────────────────┘│
                          │  per-agent boundary = Kubernetes namespace     │
                          │  (RBAC·NetworkPolicy·Quota) + Substrate        │
                          │  Atespace; cross-tenant actors never co-locate.│
                          │  in-actor sidecars: token-spiral guard ·       │
                          │  eBPF per-tool attribution.                    │
                          │            │ all outbound traffic              │
                          │            ▼ (deny-egress except gateway)      │
                          │  ┌── agentgateway  DATA PLANE ──────────────┐  │
                          │  │ LLM gw: 1 OpenAI-compat API · budgets ·   │  │
                          │  │   failover · prompt-guard · sem-routing   │  │
                          │  │ MCP gw: tool federation · OAuth · OpenAPI │  │
                          │  │ A2A: agent↔agent (cross-namespace)        │  │
                          │  │ Guardrails · CEL RBAC · rate-limit · mTLS │  │
                          │  │ token-exchange (creds minted here) · OTel │  │
                          │  └───┬─────────────┬──────────────┬─────────┘  │
                          └──────┼─────────────┼──────────────┼────────────┘
                          LLM providers    MCP tool servers   other agents
                          (OpenAI/Anthropic/  (federated)      (A2A peers)
                           Gemini/Bedrock…)
   actors stream execution events → control-plane runtime over SSE; idle actors
   suspend→snapshot; durable run state (checkpoints/handoffs) stays in the
   control plane so an actor can be rescheduled without losing progress.
   Actors hold NO provider secrets — the gateway mints scoped creds per hop.

DEPLOY SURFACES (per agent namespace): /run API · MCP server · widget · email · scheduler.
META STUDIO (Agent Studio-authored workflows targeting Agent Studio's own repo, run on the above):
  Agent Studio Dev (plan→items→actor:CLI+worktree→auto-fix→jury/debate→verify→auto-merge→rollout) ·
  RAG self-tuner · architecture-deepening sweep · self-docs wiki.
  Gated by AUTOMATED hard-gates (tests/security/review/budget); auto-rollback on bad deploy.
```

**Key architectural principles:** schema-first / declarative-config-compiles-to-runtime;
validate-the-DAG-before-run; state-outside-the-model with approval gates; ports/adapters boundaries for
testability (notably a **Runtime port** so the sandbox layer is swappable — §15-Q11);
side-effects-at-edges; graceful degradation everywhere (no embeddings → keyword fallback; no CLI → API
path).

---

## 9. Node catalog (v1)

Every node is a JSON-Schema'd type the canvas, spec, and compiler share.

**Triggers:** `trigger_manual`, `trigger_api`, `trigger_schedule`, `trigger_email`, `trigger_event`, `trigger_mcp`.
**Core:** `start`, `end`, `agent`, `tool_call`, `transform`, `subworkflow`.
**Control flow:** `router`, `classifier`, `branch`, `loop`, `parallel_fanout`, `join`, `handoff` (A2A).
**Human & legality:** `human_input`, `approval` (authorization receipt), `gate` (transition legality).
**Knowledge:** `retrieval`, `skill_load`, `memory_read`, `memory_write`.
**Review/eval:** `jury`, `adversarial_debate`, `premortem`, `quality_gate`, `verify`, `optimizer` (offline closed-loop parameter tuning), `controller` (online PI/PID process regulation).
**Safety:** `circuit_breaker` (token-spiral), `tool_policy` (attribution/enforcement), `guardrail` (content filter).
**Generative UI (advanced):** `generative_ui`.

Each `agent` node carries a declarative `middleware: [{type, config, enabled}]` list (FR-2.4).

---

## 10. Tech stack (recommended)

| Layer | Choice |
|---|---|
| Frontend | Next.js, React, TypeScript, node-graph canvas library, markdown rendering, charts |
| Design system | Light warm-neutral / dark charcoal tokens + typography |
| API | Python 3.12, FastAPI, Uvicorn, SSE, Pydantic v2 |
| Engine | Stateful agent-graph engine (LangGraph/LangChain OSS primitives) + durable checkpointer |
| Provider layer | kind-keyed registry, BYOK, encrypted-at-rest |
| **Sandbox runtime** | **Agent Substrate** (Go): actors↔workers, gVisor/microVM, sub-second snapshot suspend/resume, agent-aware router, `ActorTemplate`/`WorkerPool`/`SandboxConfig` CRDs |
| **Connectivity fabric** | **agentgateway** (Rust proxy + Go Gateway-API controller): LLM gw (OpenAI-compat, budgets, failover), MCP gw (federation/OAuth), A2A, guardrails, CEL RBAC, HBONE mTLS, OTel |
| Orchestration | Kubernetes, namespace-per-agent, Operator + CRDs, GitOps reconciler, Kustomize |
| AuthN/Z | OIDC/SSO (dual-issuer), BFF, scope-aware RBAC + gateway JWT/OAuth/token-exchange |
| Storage (dev) | SQLite + embedded vector store + local container runtime (`kind`/`minikube`) |
| Storage (prod) | Postgres + pgvector + Redis (in `agent-studio-system`) |
| In-actor guards | token-spiral guard, eBPF per-tool attribution |
| Agent-CLI backends | Claude Code / Codex / Cursor / Aider / Gemini CLI adapters |
| Desktop (later) | Desktop shell scaffold |

**Language note:** the control-plane API and compiler are Python; the Kubernetes operator/reconciler may
be Go or Python — see §15-Q6. Substrate is Go; agentgateway is Rust + a Go controller. Session actors are
language-agnostic containers.

---

## 11. Non-functional requirements

- **Security:** BYOK, secrets encrypted at rest; creds minted at the gateway / masked by sidecars; egress
  governed at the fabric; sandboxed code tools; per-tool policy; no secret in a trace/span/snapshot.
- **Autonomy safety:** the self-build loop is autonomous but bounded by *automated* controls — every
  irreversible action (merge, deploy, over-budget spend) must pass its hard-gate and is recorded as a
  single-use, state-fingerprinted authorization receipt; fail-closed when legality can't be resolved;
  failed deploys auto-roll-back. Actors are sandboxed (namespace-isolated, default-deny egress,
  seccomp/kernel isolation, no control-plane host access). Human approval is opt-in per workflow.
- **Reliability:** DAG validated before run; durable checkpoint/replay across sandbox restarts;
  token-spiral circuit breaker; structured-output repair; bounded revise loops.
- **Observability:** 100% of runs produce a span waterfall with per-node cost; wire-level OTel from the
  fabric; failure classification with suggested fixes.
- **Cost:** live per-node/per-run token+dollar meter; budgets/quotas enforced at the gateway and via
  namespace `ResourceQuota`; payload projection; semantic + prompt caching.
- **Density/latency:** many mostly-idle actors multiplex onto few warm workers; sub-second resume;
  ~100ms p95 activation target.
- **Offline/local-first:** dev runs with zero external infra; gateway standalone mode; graceful
  degradation.
- **Portability:** Linux/macOS for dev; eBPF features Linux-only and optional.

---

## 12. Milestones & the bootstrapping handoff

Autonomy is handed off in stages: humans build the M0 core, Meta Studio takes a growing share
thereafter. That handoff is not a manual dial but a **closed loop**: the self-build process controller
(FR-8.7) regulates autonomy aggressiveness against a target escaped-defect/rollback setpoint — extending
trust only as the automated gates demonstrably earn it, and ratcheting stringency back to max on any red
safety gate or bad deploy. Kubernetes/namespace isolation and the two integrated systems land early so the
self-build loop runs containerized from its first execution.

- **M0 — Hand-built core on Kubernetes.** Canvas + node schema + compiler + runtime + provider registry +
  one deploy surface (`/run` API), **plus** the Kubernetes substrate: control plane in `agent-studio-system`, the
  operator/reconciler that provisions a **per-agent namespace + atespace**, a **containerized coding-CLI
  session** behind a swappable **Runtime port** (default adapter: Substrate actor; fallback:
  pod-per-session), and **agentgateway** for model/tool access (LLM + MCP gateways). *Exit:* visually
  build a 3-node agent, deploy it into its own namespace, hit its `/run` API; a coding-CLI node executes
  in a sandboxed actor and reaches models only through the gateway.
- **M1 — Autonomous Meta Studio v0 (first self-build).** Ship the "Agent Studio Dev" workflow (plan→items→
  actor:CLI+worktree→auto-fix→jury/debate/premortem→verify→**auto-merge**→rollout) targeting Agent Studio's own
  repo, **fully autonomous behind automated hard-gates** (human approval off by default). Add the repo
  knowledge base, cost/trace observability, and the full safety layer (legality + circuit breaker +
  tool-policy + guardrails + auto-rollback). *Exit:* a real Agent Studio feature is planned, coded, reviewed,
  merged, and deployed by the loop with no human click, and a bad change is caught by a gate or rolled
  back.
- **M2 — Capability breadth.** Tool builder (REST/GraphQL/SQL/code/MCP + projection), OAuth connector
  registry, knowledge/RAG + skills ingestion, memory + consolidation, more deploy surfaces (MCP server,
  widget, email, scheduler), A2A multi-agent workflows, self-docs wiki, RBAC/SSO hardening. *Exit:* build
  a non-trivial external agent end-to-end and deploy it 3 ways into its own namespace.
- **M3 — Self-improvement + hardening.** RAG self-tuner and architecture-deepening sweep autonomously
  feeding the Dev loop; multi-tenant hardening (network policy, quotas, CEL policy); multi-host export +
  plugin packaging; optional desktop build. *Exit:* an Agent Studio-authored improvement to Agent Studio's own retrieval
  ships autonomously, metric-gated; two isolated agents run concurrently in separate namespaces.

**Success = the crossover:** by end of M3, a majority of Agent Studio's own merged PRs originate **autonomously**
from Meta Studio workflows, not hand-written by maintainers.

---

## 13. Licensing

- **Core:** Apache-2.0. Avoid Elastic-licensed and other source-available runtime dependencies in the
  core; build on OSS engine primitives.
- Any component under a restrictive/source-available license is integrated as an **optional, isolated
  sidecar**, never a required core dependency.
- The two directly-integrated systems are Apache-2.0 (**Agent Substrate**, **agentgateway**).
- Adapted/native code is reimplemented into Agent Studio's codebase with appropriate in-source attribution;
  license-audit every borrowed component before shipping.

---

## 14. Capability inventory (features & subfeatures)

Grouped feature set. Only the two directly-integrated systems are named; everything else is native.

- **Visual builder:** node-graph canvas, palette, config forms, live test panel, DAG validation +
  reachability, spec⇄canvas round-trip, light/dark design system.
- **Spec & compiler:** JSON-Schema node catalog, spec→executable-graph compiler (routers/branches/guards),
  optional YAML agent-spec + orchestrator, declarative agent middleware stack.
- **Runtime:** SSE streaming, topological-layer parallelism, durable checkpoint/replay, handoff artifacts,
  state-machine orchestration with approval gates, structured-output repair, distributed execution via a
  swappable **Runtime port**.
- **Models & backends:** kind-keyed provider registry, per-node model + fallbacks, BYOK encrypted,
  containerized coding-CLI backends, broad provider matrix via one gateway endpoint.
- **Safety:** transition-legality runtime, single-use authorization receipts + HITL approvals subsystem,
  token-spiral circuit breaker, per-tool eBPF attribution + policy, egress governance, content guardrails.
- **Tools & connectors:** REST/GraphQL/SQL/code/MCP tool builder + JMESPath projection, AST-sandboxed
  code tools, OAuth connector registry, MCP both ways, generative UI, gateway-minted credentials.
- **Knowledge & memory:** hybrid RAG (crawl/split/embed/rerank/pgvector), repo knowledge base (AST facts +
  BM25+dense+RRF+rerank), RAG self-eval loop, document→skill ingestion, agent memory + nightly
  consolidation.
- **Review & evaluation:** ensemble jury + arbiter, adversarial attacker/defender debate, pre-mortem
  critic, hard quality-gate pipeline, propose/verify separation, closed-loop parameter optimizer
  (LLM-set targets + evolutionary/Bayesian search + eval feedback), self-build process controller
  (online PI/PID regulation of autonomy vs a defect/rollback setpoint, safety-floored + asymmetric).
- **Observability & cost:** span waterfall + per-node cost, wire-level OTel, failure classification,
  session/event model, budgets/quotas, semantic + prompt caching.
- **Deploy & distribution:** /run API, MCP server, embeddable widget, email channel, scheduler/triggers,
  ambient/observer agents, multi-host export + plugin packaging.
- **Docs & demos:** source-cited rebuildable wiki with citation-linting + guarded publish,
  workflow-as-slides export, optional desktop shell.
- **Substrate (integrated):** namespace-per-agent, GitOps reconciler, high-density actor runtime with
  sub-second snapshot suspend/resume, `ActorTemplate`/`WorkerPool`/`SandboxConfig`, agent-aware routing,
  state locality.
- **agentgateway (integrated):** LLM gateway (budgets/failover/routing), MCP gateway (federation/OAuth/
  OpenAPI), A2A agent mesh, guardrails, CEL RBAC, token-exchange, HBONE mTLS, wire-level OTel, Gateway-API
  controller.

---

## 15. Risks & open questions

**Risks**
- **R1 — Scope.** A broad feature set + Kubernetes + a snapshot runtime + a data-plane proxy risks a
  sprawling v1. *Mitigation:* M0/M1 use only the native core spine + the two integrated systems + one
  autonomous self-build loop; everything else is post-M1 and behind feature flags. The two integrated
  systems are independently-deployable real projects, lowering integration risk.
- **R2 — Full-autonomy blast radius.** Autonomous agents merging/deploying changes to their own platform
  is high-risk. *Mitigation:* namespace/actor sandboxing (no control-plane host access), worktree
  isolation, propose/verify, legality runtime, hard automated gates that block merge, auto-rollback on bad
  deploy, and a per-workflow kill switch. A **canary namespace** validates self-changes before they touch
  `agent-studio-system`.
- **R3 — Self-modification of the control plane.** The loop could break the very system running it.
  *Mitigation:* control-plane changes deploy to a canary first, gated on health; the reconciler can roll
  the control plane back; the supervising operator is change-frozen except under human approval.
- **R4 — License contamination.** Source-available components. *Mitigation:* keep them optional sidecars,
  license-audit before shipping (§13).
- **R5 — Language/infra complexity.** Python core + Go operator + native guards + Kubernetes + a Go
  snapshot runtime + a Rust/Go proxy raises build/ops complexity. *Mitigation:* pick one operator language
  (Q6); each integrated system is a self-contained deployable; local dev + gateway standalone mode avoid
  needing a full cluster to author.
- **R6 — Provider drift / cost blowups.** *Mitigation:* circuit breaker (zero-LLM), gateway budgets +
  namespace `ResourceQuota`, projection + caching, per-node model fallbacks.
- **R7 — Substrate maturity.** Agent Substrate is early/pre-production ("APIs almost guaranteed to
  change"; parts aspirational; snapshot/restore of a live coding-CLI + terminal is non-trivial).
  *Mitigation:* isolate it behind a **Runtime port** — default adapter = Substrate; fallback =
  pod-per-session (no suspend/resume, lower density) — so Agent Studio ships regardless. Pin versions; track
  upstream. Density/latency are optimizations, not correctness dependencies.
- **R8 — Snapshot security & data.** Suspended actors persist full RAM+FS snapshots (may contain secrets/
  source). *Mitigation:* encrypt snapshots at rest, scope per tenant/atespace, short TTLs, keep credential
  material out of the actor (minted at the gateway), audit snapshot access.
- **R9 — Connectivity fabric as hot path / SPOF.** All agent traffic depends on agentgateway.
  *Mitigation:* run it HA (horizontally-scalable by design), health-check + auto-rollback its own
  rollouts, keep an in-process MCP/egress break-glass fallback for local/standalone mode.

**Resolved (v0.4):** Q1 web-first ✔ · Q2 full autonomy ✔ · Q4 Kubernetes multi-tenant, namespace-per-agent
✔ · Q5 containerized coding CLIs on the high-density actor runtime ✔ · Q9 model access via the gateway
LLM endpoint ✔.

**Still open (recommend resolving before M0)**
- **Q3 — Name:** working name is **Agent Studio**. Open item: it shares the "Agent" prefix with the two
  integrated subsystems (Agent Substrate, agentgateway), so lock in wordmark/logo treatment that keeps the
  product visually distinct from its own plumbing before external launch. Trademark/domain search pending.
- **Q6 — Operator language:** Go vs Python/kopf for the Kubernetes operator/reconciler? Recommend Go for the
  operator, Python for the control-plane API/compiler.
- **Q7 — Kubernetes assumptions:** which version/features and distribution to rely on (Ingress vs Gateway
  API, Pod Security Admission + SecurityContext, ingress controller, an OIDC provider such as Keycloak,
  GitOps tooling like Argo CD/Flux)? Affects the reconciler and auth design. Target vanilla Kubernetes;
  avoid distro-specific primitives.
- **Q8 — Image supply chain:** where do actor/coding-CLI images live, and how are they built/signed?
  Self-build implies Agent Studio rebuilds its own images — needs a trusted, gated, signed image pipeline.
- **Q10 — Isolation vs density dial (FR-12.8):** default WorkerPool sharing — dedicated per tenant
  namespace vs shared per trust tier? Recommend dedicated for the self-build tenant, shared-per-trust-tier
  for ordinary agents.
- **Q11 — Runtime port & Substrate adoption (R7):** ship on Substrate from M0, or start on pod-per-session
  behind the port and cut over at M2? Recommend building the port at M0 and using Substrate as the default
  adapter as early as it proves stable.
- **Q12 — agentgateway topology:** shared gateway per trust tier vs a gateway per tenant namespace?
  Recommend per-trust-tier shared gateways with per-tenant CEL policy + budgets, and a dedicated gateway
  for the self-build tenant.
- **Q13 — Standalone vs controller mode:** gateway flat-YAML in local dev + Go/Gateway-API controller on
  Kubernetes? Recommend yes — mirrors the control-plane's own dev/prod split.

---

## 16. Success metrics
- **Time-to-first-agent:** a user visually builds a 3-node agent and it is running in **its own namespace**
  with a live `/run` API in < 15 min.
- **Autonomous self-build crossover:** ≥ 50% of Agent Studio's own merged PRs are planned, coded, reviewed,
  merged, and deployed **autonomously** by Meta Studio workflows by M3 (no human click).
- **Gate efficacy:** automated hard-gates (jury + adversarial + tests + security) catch ≥ X% of seeded
  defects before merge vs a single-model baseline; escaped-defect rate trends to zero.
- **Isolation:** zero cross-namespace incidents; a fault or runaway in one agent never affects another or
  the control plane.
- **Autonomy safety:** zero irreversible actions bypass their gate; every failed deploy auto-rolls-back;
  the control-plane canary catches self-modifications before they reach `agent-studio-system`.
- **Density/latency:** sub-second actor resume at target; many idle actors sustained per warm worker.
- **Observability & cost:** 100% of runs have complete cost/trace waterfalls; zero runaway runs escape the
  circuit breaker or namespace `ResourceQuota` in load tests.
