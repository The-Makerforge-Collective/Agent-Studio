"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { listRuns, listWorkflows, RunSummary } from "@/lib/api";
import AppShell from "@/components/AppShell";

interface WorkflowMeta {
  id: string;
  name: string;
}

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [workflows, setWorkflows] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filterWf, setFilterWf] = useState<string>("");
  const [wfList, setWfList] = useState<WorkflowMeta[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
    loadData();
  }, []);

  useEffect(() => {
    loadRuns();
  }, [filterWf]);

  async function loadData() {
    try {
      const wfs = (await listWorkflows()) as WorkflowMeta[];
      const map: Record<string, string> = {};
      for (const w of wfs) map[w.id] = w.name;
      setWorkflows(map);
      setWfList(wfs);
    } catch {
      /* ignored */
    }
    await loadRuns();
  }

  async function loadRuns() {
    try {
      const r = await listRuns(filterWf ? { workflow_id: filterWf } : {});
      setRuns(r);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }

  function timeAgo(ts: number) {
    if (!ts) return "—";
    const diff = Math.floor(
      (Date.now() - (ts > 1e12 ? ts : ts * 1000)) / 1000
    );
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function duration(start: number, end: number) {
    if (!end) return "—";
    const ms = Math.round((end - start) * 1000);
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function statusBadge(status: string) {
    const styles: Record<string, string> = {
      completed: "bg-emerald-500/10 text-emerald-600",
      running: "bg-amber-500/10 text-amber-600",
      failed: "bg-red-500/10 text-red-500",
      paused: "bg-blue-500/10 text-blue-600",
    };
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          styles[status] || "bg-surface text-text-muted"
        }`}
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            status === "completed"
              ? "bg-emerald-500"
              : status === "running"
                ? "bg-amber-500 animate-pulse"
                : status === "failed"
                  ? "bg-red-500"
                  : "bg-blue-500"
          }`}
        />
        {status}
      </span>
    );
  }

  return (
    <AppShell>
      <div className="px-10 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-text">
              Runs
            </h2>
            <p className="mt-1.5 text-sm text-text-muted">
              Workflow execution history and status.
            </p>
          </div>
          <select
            value={filterWf}
            onChange={(e) => setFilterWf(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
          >
            <option value="">All workflows</option>
            {wfList.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/8 text-accent">
              <PlayIcon />
            </div>
            <p className="text-sm font-medium text-text">No runs yet</p>
            <p className="mt-1 text-xs text-text-muted">
              Run a workflow to see execution history here
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-surface-card">
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted">
                    Workflow
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted">
                    Started
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted">
                    Duration
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border/30 transition-colors hover:bg-surface-card/50 cursor-pointer"
                    onClick={() =>
                      r.workflow_id &&
                      router.push(`/agents/${r.workflow_id}`)
                    }
                  >
                    <td className="px-4 py-3">{statusBadge(r.status)}</td>
                    <td className="px-4 py-3 text-sm text-text">
                      {workflows[r.workflow_id] || r.workflow_id || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {timeAgo(r.started_at)}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-text-muted">
                      {duration(r.started_at, r.finished_at)}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-xs text-red-500">
                      {r.error_message || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M5 3l7 5-7 5V3z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
