"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { listWorkflows } from "@/lib/api";
import AppShell from "@/components/AppShell";

interface WorkflowSummary {
  id: string;
  name: string;
  created_at: number;
  spec?: { nodes: unknown[]; edges: unknown[] };
}

export default function AgentsPage() {
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

  return (
    <AppShell>
      <div className="dashboard-fade-in px-10 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold tracking-tight text-text">
            Agents
          </h2>
          <p className="mt-1.5 text-sm text-text-muted">
            Interact with your agentic workflows through a conversational interface.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/8 text-accent">
              <ChatBubbleIcon />
            </div>
            <p className="text-sm font-medium text-text">No workflows yet</p>
            <p className="mt-1 text-xs text-text-muted">
              Create a workflow first, then interact with it as an agent
            </p>
            <button
              onClick={() => router.push("/workflows/new")}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover"
            >
              Create Workflow
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className="group rounded-xl border border-border/60 bg-surface-card p-5 text-left transition-all hover:border-accent/40 hover:shadow-sm"
              >
                <button
                  onClick={() => router.push(`/agents/${wf.id}`)}
                  className="w-full text-left"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/8 text-accent group-hover:bg-accent/15">
                    <ChatBubbleIcon />
                  </div>
                  <div className="text-sm font-medium text-text group-hover:text-accent">
                    {wf.name}
                  </div>
                  {wf.spec && (
                    <div className="mt-1 text-xs text-text-muted">
                      {wf.spec.nodes.length} nodes &middot; {wf.spec.edges.length} edges
                    </div>
                  )}
                </button>
                <button
                  onClick={() => router.push(`/workflows/${wf.id}`)}
                  className="mt-3 text-[11px] text-text-muted hover:text-accent transition-colors"
                >
                  View workflow &rarr;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ChatBubbleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M3 3.5h12A1.5 1.5 0 0116.5 5v6a1.5 1.5 0 01-1.5 1.5h-3.5L8 15v-2.5H3A1.5 1.5 0 011.5 11V5A1.5 1.5 0 013 3.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="8" r="0.8" fill="currentColor" />
      <circle cx="9" cy="8" r="0.8" fill="currentColor" />
      <circle cx="12" cy="8" r="0.8" fill="currentColor" />
    </svg>
  );
}
