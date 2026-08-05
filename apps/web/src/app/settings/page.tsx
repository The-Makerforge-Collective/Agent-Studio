"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  testProvider,
  LlmProvider,
} from "@/lib/api";
import AppShell from "@/components/AppShell";

export default function SettingsPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    status: string;
    message: string;
  } | null>(null);

  const [form, setForm] = useState({
    name: "",
    provider_type: "openai",
    base_url: "",
    api_key: "",
    is_default: true,
  });

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
    loadProviders();
  }, []);

  async function loadProviders() {
    try {
      const list = await listProviders();
      setProviders(list);
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }

  function openEdit(p: LlmProvider) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      provider_type: p.provider_type,
      base_url: p.base_url,
      api_key: "",
      is_default: p.is_default,
    });
    setShowForm(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingId) {
        const body: Record<string, unknown> = {
          name: form.name,
          provider_type: form.provider_type,
          base_url: form.base_url,
          is_default: form.is_default,
        };
        if (form.api_key) body.api_key = form.api_key;
        await updateProvider(editingId, body as Parameters<typeof updateProvider>[1]);
      } else {
        await createProvider(form);
      }
      setForm({
        name: "",
        provider_type: "openai",
        base_url: "",
        api_key: "",
        is_default: true,
      });
      setEditingId(null);
      setShowForm(false);
      loadProviders();
    } catch {
      /* handled by api.ts */
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete provider "${name}"?`)) return;
    try {
      await deleteProvider(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
    } catch {
      /* ignored */
    }
  }

  async function handleTest(id: string) {
    setTesting(id);
    setTestResult(null);
    try {
      const result = await testProvider(id);
      setTestResult({ id, ...result });
    } catch {
      setTestResult({ id, status: "error", message: "Request failed" });
    } finally {
      setTesting(null);
    }
  }

  return (
    <AppShell>
      <div className="px-10 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-text">
              Settings
            </h2>
            <p className="mt-1.5 text-sm text-text-muted">
              Configure LLM providers for your agent workflows.
            </p>
          </div>
          <button
            onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name: "", provider_type: "openai", base_url: "", api_key: "", is_default: true }); }}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-md hover:shadow-accent/25 active:scale-[0.98]"
          >
            {showForm ? "Cancel" : "Add Provider"}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleCreate}
            className="mb-8 rounded-xl border border-border/60 bg-surface-card p-6"
          >
            <h3 className="mb-4 text-sm font-semibold text-text">
              {editingId ? "Edit Provider" : "New LLM Provider"}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Name
                </span>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="My OpenAI Key"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Provider Type
                </span>
                <select
                  value={form.provider_type}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, provider_type: e.target.value }))
                  }
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Base URL (optional)
                </span>
                <input
                  type="text"
                  value={form.base_url}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, base_url: e.target.value }))
                  }
                  placeholder={
                    form.provider_type === "anthropic"
                      ? "https://api.anthropic.com"
                      : "https://api.openai.com/v1"
                  }
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  API Key{editingId ? " (leave blank to keep current)" : ""}
                </span>
                <input
                  type="password"
                  required={!editingId}
                  value={form.api_key}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, api_key: e.target.value }))
                  }
                  placeholder="sk-..."
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, is_default: e.target.checked }))
                  }
                  className="rounded border-border"
                />
                Set as default provider
              </label>
              <div className="flex-1" />
              <button
                type="submit"
                className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-all hover:bg-accent-hover"
              >
                {editingId ? "Update Provider" : "Save Provider"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : providers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/8 text-accent">
              <KeyIcon />
            </div>
            <p className="text-sm font-medium text-text">
              No LLM providers configured
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Add an OpenAI or Anthropic API key to enable agent nodes
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover"
            >
              Add Provider
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-4 rounded-xl border border-transparent bg-surface-card px-5 py-4 transition-all hover:border-border hover:shadow-sm"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/8 text-accent">
                  <KeyIcon />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">
                      {p.name}
                    </span>
                    {p.is_default && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {p.provider_type === "anthropic" ? "Anthropic" : "OpenAI"}
                    {p.base_url ? ` · ${p.base_url}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {testResult?.id === p.id && (
                    <span
                      className={`text-xs font-medium ${
                        testResult.status === "ok"
                          ? "text-emerald-600"
                          : "text-red-500"
                      }`}
                    >
                      {testResult.status === "ok"
                        ? "Connected"
                        : testResult.message}
                    </span>
                  )}
                  <button
                    onClick={() => handleTest(p.id)}
                    disabled={testing === p.id}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface transition-colors disabled:opacity-50"
                  >
                    {testing === p.id ? "Testing..." : "Test"}
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="rounded-md p-1.5 text-text-muted/30 opacity-0 transition-all hover:bg-accent/10 hover:text-accent group-hover:opacity-100"
                    title="Edit"
                  >
                    <EditIcon />
                  </button>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="rounded-md p-1.5 text-text-muted/30 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-500/10"
                    title="Delete"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="5.5" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 8.5l5 5M11 11.5l2-2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2 12h1.5L10 5.5 8.5 4 2 10.5V12zM8.5 4l1.5-1.5 1.5 1.5L10 5.5 8.5 4z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M3 3.5h8M5.5 3.5V2.5a1 1 0 011-1h1a1 1 0 011 1v1M6 6v3.5M8 6v3.5M3.5 3.5l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
