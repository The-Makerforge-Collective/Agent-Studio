"use client";

import { useRouter } from "next/navigation";

export interface TopBarProps {
  workflowName: string;
  onNameChange: (name: string) => void;
  onCompile: () => void;
  onSave: () => void;
  onDeploy: () => void;
  onRun: () => void;
  onToggleSpec: () => void;
  onDownloadCode?: () => void;
  onDelete?: () => void;
  showSpec: boolean;
  compileStatus: { ok: boolean; errors: string[] } | null;
  saving: boolean;
  workflowId?: string | null;
}

export default function TopBar({
  workflowName,
  onNameChange,
  onCompile,
  onSave,
  onDeploy,
  onRun,
  onToggleSpec,
  onDownloadCode,
  onDelete,
  showSpec,
  compileStatus,
  saving,
  workflowId,
}: TopBarProps) {
  const router = useRouter();
  return (
    <div className="flex h-12 items-center justify-between border-b border-border bg-surface-card px-4">
      {/* Left section: breadcrumb */}
      <div className="flex items-center gap-3">
        <nav className="flex items-center gap-1.5 text-sm">
          <span className="text-text-muted">Workflows</span>
          <span className="text-text-muted">&rsaquo;</span>
          <input
            type="text"
            value={workflowName}
            onChange={(e) => onNameChange(e.target.value)}
            className="rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-text outline-none hover:border-border focus:border-accent focus:bg-surface"
            placeholder="Workflow name"
          />
        </nav>
      </div>

      {/* Center section: Action buttons */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-surface px-1 py-0.5">
          <button
            onClick={onCompile}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-text hover:bg-surface-card transition-colors"
          >
            <span className="text-green-600">&#10003;</span>
            Compile
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-text hover:bg-surface-card disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
            ) : (
              <span>&#128190;</span>
            )}
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={onDeploy}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-text hover:bg-surface-card transition-colors"
          >
            <span>&#128640;</span>
            Deploy
          </button>
          <button
            onClick={onRun}
            className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1 text-xs font-semibold text-white hover:bg-accent-hover transition-colors"
          >
            <span>&#9654;</span>
            Run
          </button>
          {workflowId && (
            <button
              onClick={() => router.push(`/agents/${workflowId}`)}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-text hover:bg-surface-card transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M2 2.5h10a1 1 0 011 1v5a1 1 0 01-1 1H8L5.5 12v-2.5H2a1 1 0 01-1-1v-5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="5" cy="6" r="0.6" fill="currentColor"/>
                <circle cx="7" cy="6" r="0.6" fill="currentColor"/>
                <circle cx="9" cy="6" r="0.6" fill="currentColor"/>
              </svg>
              Chat
            </button>
          )}
          {onDownloadCode && (
            <button
              onClick={onDownloadCode}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-text hover:bg-surface-card transition-colors"
            >
              &#8595; Code
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          )}
          <div className="flex rounded-full border border-border overflow-hidden">
            <button
              onClick={showSpec ? onToggleSpec : undefined}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                !showSpec
                  ? "bg-accent text-white"
                  : "text-text-muted hover:text-text hover:bg-surface-card"
              }`}
            >
              Canvas
            </button>
            <button
              onClick={!showSpec ? onToggleSpec : undefined}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                showSpec
                  ? "bg-accent text-white"
                  : "text-text-muted hover:text-text hover:bg-surface-card"
              }`}
            >
              Spec
            </button>
          </div>
        </div>
      </div>

      {/* Right section: Status */}
      <div className="flex items-center gap-3">
        {compileStatus && (
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              compileStatus.ok
                ? "bg-green-500/10 text-green-600"
                : "bg-red-500/10 text-red-500"
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                compileStatus.ok ? "bg-green-500" : "bg-red-500"
              }`}
            />
            {compileStatus.ok ? "Valid" : compileStatus.errors[0]}
          </div>
        )}
      </div>
    </div>
  );
}
