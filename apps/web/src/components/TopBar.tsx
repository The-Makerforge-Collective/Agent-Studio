"use client";

import { useState, useRef, useEffect } from "react";
import { getEmail, logout } from "@/lib/auth";

interface TopBarProps {
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
  onDownloadCode: _onDownloadCode,
  onDelete: _onDelete,
  showSpec,
  compileStatus,
  saving,
  workflowId: _workflowId,
}: TopBarProps) {
  const email = getEmail();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const userInitial = email ? email.charAt(0).toUpperCase() : "U";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    if (showUserMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUserMenu]);

  return (
    <div className="flex h-14 items-center justify-between border-b border-border bg-surface-card px-4">
      {/* Left section: Logo + breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            className="text-accent"
          >
            <path
              d="M12 2L3 7v10l9 5 9-5V7l-9-5z"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
            <circle cx="12" cy="4" r="2" fill="currentColor" />
            <circle cx="5" cy="15" r="2" fill="currentColor" />
            <circle cx="19" cy="15" r="2" fill="currentColor" />
            <line
              x1="12"
              y1="4"
              x2="5"
              y2="15"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="12"
              y1="4"
              x2="19"
              y2="15"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="5"
              y1="15"
              x2="19"
              y2="15"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          <span className="text-sm font-semibold text-text">Agent Studio</span>
        </div>

        <div className="border-l border-border h-6" />

        <nav className="flex items-center gap-1.5 text-sm">
          <a
            href="/workflows"
            className="text-text-muted hover:text-text transition-colors"
          >
            Workflows
          </a>
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

      {/* Right section: Status + user */}
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

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white hover:bg-accent-hover transition-colors"
            title={email ?? "User"}
          >
            {userInitial}
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-lg border border-border bg-surface-card shadow-lg">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs font-medium text-text truncate">
                  {email}
                </p>
              </div>
              <div className="py-1">
                <button className="w-full px-3 py-1.5 text-left text-xs text-text hover:bg-surface transition-colors">
                  Settings
                </button>
                <button className="w-full px-3 py-1.5 text-left text-xs text-text hover:bg-surface transition-colors">
                  Help
                </button>
              </div>
              <div className="border-t border-border py-1">
                <button
                  onClick={logout}
                  className="w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-surface transition-colors"
                >
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
