"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAuthenticated, getEmail } from "@/lib/auth";
import { listWorkflows, checkHealth } from "@/lib/api";
import { Workflow } from "@/lib/types";

interface StatCard {
  label: string;
  value: string;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DashboardPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
    setEmail(getEmail());

    listWorkflows()
      .then((data) => {
        setWorkflows(data as Workflow[]);
      })
      .catch(() => {
        setWorkflows([]);
      })
      .finally(() => setLoading(false));

    checkHealth()
      .then(() => setApiHealthy(true))
      .catch(() => setApiHealthy(false));
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const stats: StatCard[] = [
    { label: "Total Workflows", value: loading ? "..." : String(workflows.length) },
    { label: "Deployed", value: "—" },
    { label: "Total Runs", value: "—" },
    { label: "Uptime", value: "99.9%" },
  ];

  const recentWorkflows = workflows.slice(0, 6);

  return (
    <div className="dashboard-fade-in min-h-screen bg-surface">
      {/* Header */}
      <header className="border-b border-border bg-surface-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white text-sm font-bold">
              A
            </div>
            <span className="text-lg font-semibold text-text">Agent Studio</span>
          </div>
          <div className="text-sm text-text-muted">{today}</div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-text">Welcome back</h1>
          {email && (
            <p className="mt-1 text-sm text-text-muted">{email}</p>
          )}
        </div>

        {/* Stats Row */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border bg-surface-card p-6 transition-shadow hover:shadow-md"
            >
              <div className="text-3xl font-bold text-text">{stat.value}</div>
              <div className="mt-1 text-sm text-text-muted">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column: Recent Workflows */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-surface-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text">Recent Workflows</h2>
                {workflows.length > 0 && (
                  <Link
                    href="/workflows"
                    className="text-sm text-accent hover:text-accent-hover transition-colors"
                  >
                    View all
                  </Link>
                )}
              </div>

              {loading ? (
                <div className="py-12 text-center text-text-muted">Loading...</div>
              ) : recentWorkflows.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mb-2 text-4xl text-text-muted">~</div>
                  <p className="text-text-muted">No workflows yet</p>
                  <Link
                    href="/"
                    className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                  >
                    Create your first workflow
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recentWorkflows.map((wf) => (
                    <div
                      key={wf.id}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-text">
                          {wf.name}
                        </div>
                        <div className="mt-0.5 text-xs text-text-muted">
                          {wf.spec?.nodes?.length ?? 0} nodes &middot; {formatDate(wf.created_at)}
                        </div>
                      </div>
                      <Link
                        href={`/?id=${wf.id}`}
                        className="ml-4 shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface"
                      >
                        Open
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <div className="rounded-xl border border-border bg-surface-card p-6">
              <h2 className="mb-4 text-lg font-semibold text-text">Quick Actions</h2>
              <div className="space-y-3">
                <Link
                  href="/"
                  className="block w-full rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  New Workflow
                </Link>
                <button
                  disabled
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-text-muted cursor-not-allowed"
                >
                  Browse Templates
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                    Soon
                  </span>
                </button>
                <button
                  disabled
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-text-muted cursor-not-allowed"
                >
                  Documentation
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                    Soon
                  </span>
                </button>
              </div>
            </div>

            {/* Platform Status */}
            <div className="rounded-xl border border-border bg-surface-card p-6">
              <h2 className="mb-4 text-lg font-semibold text-text">Platform Status</h2>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      apiHealthy === true
                        ? "bg-green-500"
                        : apiHealthy === false
                        ? "bg-red-500"
                        : "bg-gray-400"
                    }`}
                  />
                  <span className="text-text">API</span>
                  <span className="ml-auto text-text-muted">
                    {apiHealthy === true
                      ? "Healthy"
                      : apiHealthy === false
                      ? "Unreachable"
                      : "Checking..."}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
                  <span className="text-text">Gateway</span>
                  <span className="ml-auto text-text-muted">Not configured</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
                  <span className="text-text">Keycloak</span>
                  <span className="ml-auto text-text-muted">Not configured</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
