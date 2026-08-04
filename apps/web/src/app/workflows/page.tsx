"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { listWorkflows } from "@/lib/api";
import { Workflow } from "@/lib/types";

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }

    async function load() {
      try {
        const data = await listWorkflows();
        setWorkflows(data as Workflow[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load workflows");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  function formatDate(dateStr?: string): string {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text">Workflows</h1>
          <button
            onClick={() => router.push("/")}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            New Workflow
          </button>
        </div>

        {loading && (
          <p className="text-sm text-text-muted">Loading workflows...</p>
        )}

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        {!loading && !error && workflows.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-card p-8 text-center">
            <p className="text-text-muted">No workflows yet.</p>
            <button
              onClick={() => router.push("/")}
              className="mt-4 text-sm font-medium text-accent hover:text-accent-hover"
            >
              Create your first workflow
            </button>
          </div>
        )}

        {!loading && !error && workflows.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {workflows.map((wf) => (
              <button
                key={wf.id}
                onClick={() => router.push(`/?id=${wf.id}`)}
                className="rounded-lg border border-border bg-surface-card p-4 text-left transition-colors hover:border-accent"
              >
                <h2 className="truncate text-sm font-semibold text-text">
                  {wf.name}
                </h2>
                <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
                  <span>
                    {wf.spec?.nodes?.length ?? 0}{" "}
                    {(wf.spec?.nodes?.length ?? 0) === 1 ? "node" : "nodes"}
                  </span>
                  {wf.created_at && (
                    <>
                      <span className="text-border">|</span>
                      <span>{formatDate(wf.created_at)}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
