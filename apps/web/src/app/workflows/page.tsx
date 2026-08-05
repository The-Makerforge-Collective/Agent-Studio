"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { listWorkflows, deleteWorkflow } from "@/lib/api";
import AppShell from "@/components/AppShell";

interface WorkflowSummary {
  id: string;
  name: string;
  created_at: number;
  created_by?: string;
  spec?: { nodes: unknown[]; edges: unknown[] };
}

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
    listWorkflows()
      .then((wfs) => wfs as WorkflowSummary[])
      .then((wfs) => {
        wfs.sort((a, b) => b.created_at - a.created_at);
        setWorkflows(wfs);
      })
      .catch(() => setWorkflows([]))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <AppShell>
      <div className="dashboard-fade-in px-10 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-text">
              Workflows
            </h2>
            <p className="mt-1.5 text-sm text-text-muted">
              Build, edit, and manage your agent workflows.
            </p>
          </div>
          <button
            onClick={() => router.push("/workflows/new")}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-md hover:shadow-accent/25 active:scale-[0.98]"
          >
            New Workflow
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
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
            {workflows.map((wf) => (
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
          </div>
        )}
      </div>
    </AppShell>
  );
}

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
