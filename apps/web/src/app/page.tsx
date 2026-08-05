"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { listWorkflows, deleteWorkflow, fetchNodeCatalog, listMcpServers } from "@/lib/api";
import AppShell from "@/components/AppShell";

interface WorkflowSummary {
  id: string;
  name: string;
  created_at: number;
  created_by?: string;
  spec?: { nodes: unknown[]; edges: unknown[] };
}

interface HealthStatus {
  status: string;
  service: string;
  db: string;
  in_cluster: boolean;
  multi_tenant: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [nodeTypeCount, setNodeTypeCount] = useState(0);
  const [mcpCount, setMcpCount] = useState(0);
  const [totalRuns, setTotalRuns] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
    loadDashboard();
  }, []);

  async function loadDashboard() {
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8088";
    const results = await Promise.allSettled([
      fetch(base + "/health").then((r) => r.json()),
      listWorkflows() as Promise<WorkflowSummary[]>,
      fetchNodeCatalog(),
      listMcpServers(),
      fetch(base + "/metrics").then((r) => r.text()),
    ]);

    if (results[0].status === "fulfilled") setHealth(results[0].value);
    if (results[1].status === "fulfilled") {
      const wfs = results[1].value;
      wfs.sort((a, b) => b.created_at - a.created_at);
      setWorkflows(wfs);
    }
    if (results[2].status === "fulfilled") {
      const c = results[2].value;
      setNodeTypeCount(Array.isArray(c) ? c.length : typeof c === "object" && c ? Object.keys(c).length : 0);
    }
    if (results[3].status === "fulfilled") setMcpCount(results[3].value.length);
    if (results[4].status === "fulfilled") {
      const m = results[4].value.match(/agent_studio_runs_total\s+(\d+)/);
      if (m) setTotalRuns(parseInt(m[1], 10));
    }
    setLoading(false);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteWorkflow(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    } catch { /* ignored */ }
  }

  function timeAgo(ts: number) {
    const diff = Math.floor((Date.now() - (ts > 1e12 ? ts : ts * 1000)) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  const isHealthy = health?.status === "ok";

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
            <span className="text-sm text-text-muted">Loading...</span>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-10 py-8">
        {/* Welcome + CTA */}
        <div className="mb-10 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-text">
              Welcome back
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
              Create agent workflows, connect tools, and run automations.
            </p>
          </div>
          <button
            onClick={() => router.push("/workflows/new")}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-md hover:shadow-accent/25 active:scale-[0.98]"
          >
            New Workflow
          </button>
        </div>

        {/* Two-column layout: left = main content, right = sidebar stats */}
        <div className="flex gap-8">
          {/* Left: primary content */}
          <div className="min-w-0 flex-1 space-y-8">
            {/* Get started cards — only if few workflows */}
            {workflows.length < 3 && (
              <section>
                <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-text-muted">
                  Get Started
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ActionCard
                    title="Create a Workflow"
                    desc="Drag and drop nodes to build an agent pipeline"
                    onClick={() => router.push("/workflows/new")}
                    icon={<PlusCircleIcon />}
                  />
                  <ActionCard
                    title="Connect a Tool Server"
                    desc="Register an MCP server so agents can use external tools"
                    onClick={() => router.push("/mcp-servers")}
                    icon={<PlugIcon />}
                  />
                </div>
              </section>
            )}

            {/* Recent workflows */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted">
                  Recent Workflows
                </h3>
                {workflows.length > 0 && (
                  <button
                    onClick={() => router.push("/workflows/new")}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    + New
                  </button>
                )}
              </div>

              {workflows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-14 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/8 text-accent">
                    <WorkflowIcon />
                  </div>
                  <p className="text-sm font-medium text-text">No workflows yet</p>
                  <p className="mt-1 text-xs text-text-muted">
                    Create your first workflow to get started
                  </p>
                  <button
                    onClick={() => router.push("/workflows/new")}
                    className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    Create Workflow
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {workflows.slice(0, 8).map((wf) => (
                    <div
                      key={wf.id}
                      onClick={() => router.push(`/workflows/${wf.id}`)}
                      className="group flex cursor-pointer items-center gap-4 rounded-xl border border-transparent bg-surface-card px-4 py-3 transition-all hover:border-border hover:shadow-sm"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/8 text-accent group-hover:bg-accent/15">
                        <WorkflowIcon />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text group-hover:text-accent">
                          {wf.name}
                        </div>
                        {wf.spec && (
                          <div className="mt-0.5 text-xs text-text-muted">
                            {wf.spec.nodes.length} nodes &middot; {wf.spec.edges.length} edges
                          </div>
                        )}
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <div className="text-xs text-text-muted">{timeAgo(wf.created_at)}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/agents/${wf.id}`); }}
                        className="shrink-0 rounded-md p-1.5 text-text-muted/30 opacity-0 transition-all hover:bg-accent/10 hover:text-accent group-hover:opacity-100"
                        title="Open in Chat"
                      >
                        <ChatLinkIcon />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(wf.id, wf.name); }}
                        className="shrink-0 rounded-md p-1.5 text-text-muted/30 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-500/10"
                        title="Delete"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                  {workflows.length > 8 && (
                    <div className="pt-1 text-center text-xs text-text-muted">
                      +{workflows.length - 8} more
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* Right: platform status sidebar */}
          <aside className="hidden w-[240px] shrink-0 lg:block">
            <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-text-muted">
              Platform
            </h3>
            <div className="space-y-3">
              <StatusRow
                label="Control Plane"
                value={isHealthy ? "Healthy" : "Down"}
                ok={isHealthy}
              />
              <StatusRow label="Workflows" value={String(workflows.length)} ok />
              <StatusRow label="Node Types" value={String(nodeTypeCount)} ok />
              <StatusRow
                label="Total Runs"
                value={totalRuns !== null ? String(totalRuns) : "—"}
                ok
              />
              <StatusRow
                label="Tool Servers"
                value={String(mcpCount)}
                ok
              />
            </div>

            <div className="mt-6 rounded-xl border border-border/60 bg-surface-card p-4">
              <h4 className="text-xs font-semibold text-text">Quick Links</h4>
              <ul className="mt-2.5 space-y-2 text-xs">
                <li>
                  <button onClick={() => router.push("/workflows/new")} className="text-accent hover:underline">
                    New Workflow
                  </button>
                </li>
                <li>
                  <button onClick={() => router.push("/mcp-servers")} className="text-accent hover:underline">
                    Manage Tool Servers
                  </button>
                </li>
                <li>
                  <button onClick={() => router.push("/skills")} className="text-accent hover:underline">
                    Browse Skills
                  </button>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

/* ——— Sub-components ——— */

function ActionCard({ title, desc, onClick, icon }: { title: string; desc: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-3.5 rounded-xl border border-border/60 bg-surface-card p-4 text-left transition-all hover:border-accent/40 hover:shadow-sm"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/8 text-accent group-hover:bg-accent/15">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-text group-hover:text-accent">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-text-muted">{desc}</div>
      </div>
    </button>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-card px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
        <span className="text-xs text-text-muted">{label}</span>
      </div>
      <span className="text-xs font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

/* ——— Icons ——— */

function WorkflowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="3" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="4" cy="13" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="12" cy="13" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 4.8V8L4.5 11.2M8 8l3.5 3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function PlusCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 5.5v5M5.5 8h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6 2v3M10 2v3M4 5h8v2a4 4 0 01-8 0V5zM8 11v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ChatLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 2.5h10a1 1 0 011 1v5a1 1 0 01-1 1H8L5.5 12v-2.5H2a1 1 0 01-1-1v-5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="5" cy="6" r="0.6" fill="currentColor"/>
      <circle cx="7" cy="6" r="0.6" fill="currentColor"/>
      <circle cx="9" cy="6" r="0.6" fill="currentColor"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 3.5h8M5.5 3.5V2.5a1 1 0 011-1h1a1 1 0 011 1v1M6 6v3.5M8 6v3.5M3.5 3.5l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
