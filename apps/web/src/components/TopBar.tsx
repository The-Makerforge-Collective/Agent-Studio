"use client";

import { getEmail, logout } from "@/lib/auth";

interface TopBarProps {
  workflowName: string;
  onNameChange: (name: string) => void;
  onCompile: () => void;
  onSave: () => void;
  onDeploy: () => void;
  onRun: () => void;
  onToggleSpec: () => void;
  showSpec: boolean;
  compileStatus: { ok: boolean; errors: string[] } | null;
  saving: boolean;
}

export default function TopBar({
  workflowName,
  onNameChange,
  onCompile,
  onSave,
  onDeploy,
  onRun,
  onToggleSpec,
  showSpec,
  compileStatus,
  saving,
}: TopBarProps) {
  const email = getEmail();

  return (
    <div className="flex h-12 items-center justify-between border-b border-border bg-surface-card px-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-bold tracking-wide text-accent">
          Agent Studio
        </span>
        <input
          type="text"
          value={workflowName}
          onChange={(e) => onNameChange(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
          placeholder="Workflow name"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onCompile}
          className="rounded border border-border px-3 py-1 text-xs font-medium hover:bg-surface"
        >
          Compile
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded border border-border px-3 py-1 text-xs font-medium hover:bg-surface disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onDeploy}
          className="rounded border border-border px-3 py-1 text-xs font-medium hover:bg-surface"
        >
          Deploy
        </button>
        <button
          onClick={onRun}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
        >
          Run
        </button>
        <button
          onClick={onToggleSpec}
          className={`rounded border px-3 py-1 text-xs font-medium ${
            showSpec ? "border-accent text-accent" : "border-border"
          } hover:bg-surface`}
        >
          {showSpec ? "Canvas" : "Spec"}
        </button>
        {compileStatus && (
          <span
            className={`text-xs ${
              compileStatus.ok ? "text-green-600" : "text-red-500"
            }`}
          >
            {compileStatus.ok
              ? "Valid"
              : compileStatus.errors[0]}
          </span>
        )}
        <div className="ml-4 flex items-center gap-2 border-l border-border pl-4">
          <span className="text-xs text-text-muted">{email}</span>
          <button
            onClick={logout}
            className="text-xs text-text-muted hover:text-text"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
