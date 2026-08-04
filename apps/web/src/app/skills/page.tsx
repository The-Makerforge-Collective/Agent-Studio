"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { isAuthenticated, logout } from "@/lib/auth";
import { listSkills, createSkill, updateSkill, deleteSkill, exportSkill, getSkill, Skill } from "@/lib/api";

const SKILL_MD_TEMPLATE = `---
name: my-skill
version: 1.0.0
description: A brief description of what this skill does
author: your-name
tags:
  - category
---

# My Skill

## Instructions

Describe the skill's behavior, goals, and constraints here.
The agent will follow these instructions when this skill is active.

## Tools

List the tools this skill provides or requires:

- \`tool-name\`: Description of what this tool does

## Input

Describe the expected input format.

## Output

Describe the expected output format.
`;

const DEFAULT_FILES: Record<string, string> = {
  "scripts/run.py": `#!/usr/bin/env python3
"""Main executable script for the skill."""


def run(input_data: dict) -> dict:
    """Entry point called by the agent runtime."""
    return {"result": "ok"}
`,
  "references/README.md": `# References

Add documentation, guides, or context files here.
The agent can read these to inform its behavior.
`,
  "assets/.gitkeep": "",
};

interface FileEntry {
  path: string;
  content: string;
}

interface FolderTree {
  [key: string]: FolderTree | string;
}

interface ContextMenu {
  x: number;
  y: number;
  targetFolder: string;
  targetFile?: string;
}

function buildTree(paths: string[]): FolderTree {
  const tree: FolderTree = {};
  for (const p of paths) {
    const parts = p.split("/");
    let cur = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        cur[part] = p;
      } else {
        if (!cur[part] || typeof cur[part] === "string") cur[part] = {};
        cur = cur[part] as FolderTree;
      }
    }
  }
  return tree;
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (name === "SKILL.md") return <span className="text-accent">S</span>;
  if (ext === "md") return <span className="text-blue-400">M</span>;
  if (ext === "py") return <span className="text-yellow-500">P</span>;
  if (ext === "js" || ext === "ts") return <span className="text-yellow-400">J</span>;
  if (ext === "json") return <span className="text-green-400">{"{"}</span>;
  if (ext === "yaml" || ext === "yml") return <span className="text-red-400">Y</span>;
  return <span className="text-text-muted">F</span>;
}

function TreeNode({
  name,
  node,
  depth,
  activeFile,
  onSelect,
  onContextMenu,
  expandedFolders,
  onToggleFolder,
  folderPath,
}: {
  name: string;
  node: FolderTree | string;
  depth: number;
  activeFile: string;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, folder: string, file?: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (folder: string) => void;
  folderPath: string;
}) {
  if (typeof node === "string") {
    const isActive = activeFile === node;
    const parentFolder = node.includes("/") ? node.substring(0, node.lastIndexOf("/")) : "";
    return (
      <button
        onClick={() => onSelect(node)}
        onContextMenu={(e) => onContextMenu(e, parentFolder, node)}
        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-[3px] text-left text-xs font-mono transition-colors ${
          isActive
            ? "bg-accent/10 text-accent"
            : "text-text-muted hover:bg-surface-card hover:text-text"
        }`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        <span className="w-3.5 text-center text-[10px] shrink-0"><FileIcon name={name} /></span>
        <span className="truncate flex-1">{name}</span>
      </button>
    );
  }

  const isOpen = expandedFolders.has(folderPath);
  const entries = Object.entries(node).sort(([, a], [, b]) => {
    const aIsDir = typeof a !== "string";
    const bIsDir = typeof b !== "string";
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return 0;
  });

  return (
    <div>
      <button
        onClick={() => onToggleFolder(folderPath)}
        onContextMenu={(e) => onContextMenu(e, folderPath)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-[3px] text-left text-xs font-mono text-text-muted hover:bg-surface-card hover:text-text transition-colors"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        <span className="w-3.5 text-center text-[10px] shrink-0">{isOpen ? "v" : ">"}</span>
        <span className="truncate">{name}</span>
      </button>
      {isOpen && entries.map(([childName, childNode]) => (
        <TreeNode
          key={childName}
          name={childName}
          node={childNode}
          depth={depth + 1}
          activeFile={activeFile}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          expandedFolders={expandedFolders}
          onToggleFolder={onToggleFolder}
          folderPath={folderPath ? `${folderPath}/${childName}` : childName}
        />
      ))}
    </div>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([
    { path: "SKILL.md", content: SKILL_MD_TEMPLATE },
  ]);
  const [activeFile, setActiveFile] = useState("SKILL.md");
  const [saving, setSaving] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["scripts", "references", "assets"])
  );
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [inlineInput, setInlineInput] = useState<{ folder: string; type: "file" | "folder" } | null>(null);
  const [inlineValue, setInlineValue] = useState("");
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
    refresh();
  }, []);

  function refresh() {
    listSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    function dismissCtx(e: MouseEvent) {
      setCtxMenu(null);
    }
    window.addEventListener("click", dismissCtx);
    return () => window.removeEventListener("click", dismissCtx);
  }, []);

  function resetEditor() {
    setEditingSkillId(null);
    setName("");
    setDescription("");
    setFiles([{ path: "SKILL.md", content: SKILL_MD_TEMPLATE }]);
    setActiveFile("SKILL.md");
    setCtxMenu(null);
    setInlineInput(null);
    setInlineValue("");
    setExpandedFolders(new Set(["scripts", "references", "assets"]));
  }

  function addScaffolding() {
    const existing = new Set(files.map((f) => f.path));
    const toAdd: FileEntry[] = [];
    for (const [path, content] of Object.entries(DEFAULT_FILES)) {
      if (!existing.has(path)) toAdd.push({ path, content });
    }
    if (toAdd.length > 0) setFiles((prev) => [...prev, ...toAdd]);
  }

  function handleInlineSubmit() {
    const val = inlineValue.trim();
    if (!val || !inlineInput) { setInlineInput(null); setInlineValue(""); return; }

    if (inlineInput.type === "file") {
      const path = inlineInput.folder ? `${inlineInput.folder}/${val}` : val;
      if (files.some((f) => f.path === path)) { setInlineInput(null); setInlineValue(""); return; }
      setFiles((prev) => [...prev, { path, content: "" }]);
      setActiveFile(path);
      const topFolder = path.split("/")[0];
      if (path.includes("/")) setExpandedFolders((prev) => new Set([...prev, topFolder]));
    } else {
      const folderName = inlineInput.folder ? `${inlineInput.folder}/${val}` : val;
      const placeholder = `${folderName}/.gitkeep`;
      if (!files.some((f) => f.path === placeholder)) {
        setFiles((prev) => [...prev, { path: placeholder, content: "" }]);
      }
      setExpandedFolders((prev) => new Set([...prev, folderName, ...(inlineInput.folder ? [inlineInput.folder] : [])]));
    }
    setInlineInput(null);
    setInlineValue("");
  }

  function handleRemoveFile(path: string) {
    setFiles((prev) => prev.filter((f) => f.path !== path));
    if (activeFile === path) setActiveFile("SKILL.md");
  }

  function handleContextMenu(e: React.MouseEvent, folder: string, file?: string) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, targetFolder: folder, targetFile: file });
  }

  function ctxNewFile() {
    if (!ctxMenu) return;
    const folder = ctxMenu.targetFolder;
    if (folder) setExpandedFolders((prev) => new Set([...prev, folder]));
    setInlineInput({ folder, type: "file" });
    setInlineValue("");
    setCtxMenu(null);
  }

  function ctxNewFolder() {
    if (!ctxMenu) return;
    const folder = ctxMenu.targetFolder;
    if (folder) setExpandedFolders((prev) => new Set([...prev, folder]));
    setInlineInput({ folder, type: "folder" });
    setInlineValue("");
    setCtxMenu(null);
  }

  function ctxDeleteFile() {
    if (!ctxMenu?.targetFile) return;
    const path = ctxMenu.targetFile;
    if (path === "SKILL.md") { setCtxMenu(null); return; }
    handleRemoveFile(path);
    setCtxMenu(null);
  }

  function ctxDeleteFolder() {
    if (!ctxMenu) return;
    const folder = ctxMenu.targetFolder;
    if (!folder) { setCtxMenu(null); return; }
    setFiles((prev) => prev.filter((f) => !f.path.startsWith(folder + "/")));
    if (activeFile.startsWith(folder + "/")) setActiveFile("SKILL.md");
    setCtxMenu(null);
  }

  const handleContentChange = useCallback(
    (content: string) => {
      setFiles((prev) =>
        prev.map((f) => (f.path === activeFile ? { ...f, content } : f))
      );
    },
    [activeFile]
  );

  function toggleFolder(folder: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  async function handleView(id: string) {
    try {
      const sk = await getSkill(id);
      setEditingSkillId(sk.id);
      setName(sk.name);
      setDescription(sk.description || "");
      const specFiles = (sk.spec?.files || {}) as Record<string, string>;
      const entries: FileEntry[] = Object.entries(specFiles).map(([path, content]) => ({ path, content }));
      if (entries.length === 0) entries.push({ path: "SKILL.md", content: "" });
      setFiles(entries);
      setActiveFile(entries[0].path);
      setExpandedFolders(new Set(entries.map(f => f.path.split("/")[0]).filter(p => p !== entries[0]?.path)));
      setShowCreate(true);
    } catch {
      alert("Failed to load skill");
    }
  }

  async function handleCreate() {
    if (!name.trim()) return;
    const spec: Record<string, unknown> = {
      format: "agentskills.io",
      files: Object.fromEntries(files.map((f) => [f.path, f.content])),
    };
    setSaving(true);
    try {
      if (editingSkillId) {
        await updateSkill(editingSkillId, { name: name.trim(), description: description.trim(), spec });
      } else {
        await createSkill({ name: name.trim(), description: description.trim(), spec });
      }
      resetEditor();
      setShowCreate(false);
      refresh();
    } catch {
      alert(editingSkillId ? "Failed to update skill" : "Failed to create skill");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, skillName: string) {
    if (!confirm(`Delete skill "${skillName}"?`)) return;
    try {
      await deleteSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert("Failed to delete skill");
    }
  }

  async function handleExport(id: string, skillName: string) {
    try {
      const data = await exportSkill(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${skillName}.skill.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export skill");
    }
  }

  function getFileTree(spec: Record<string, unknown>): string[] {
    if (spec?.files && typeof spec.files === "object") {
      return Object.keys(spec.files as Record<string, unknown>);
    }
    return [];
  }

  const filePaths = files.map((f) => f.path);
  const tree = buildTree(filePaths);
  const activeContent = files.find((f) => f.path === activeFile)?.content || "";
  const activeExt = activeFile.split(".").pop()?.toLowerCase() || "";
  const lineCount = activeContent.split("\n").length;

  return (
    <div className="dashboard-fade-in min-h-screen bg-surface">
      <header className="border-b border-border bg-surface-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white text-sm font-bold">A</div>
              <span className="text-lg font-semibold text-text">Agent Studio</span>
            </Link>
            <span className="text-text-muted">/</span>
            <span className="text-lg font-semibold text-text">Skills</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setShowCreate(!showCreate); if (showCreate) resetEditor(); }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              {showCreate ? "Cancel" : "New Skill"}

            </button>
            <button
              onClick={logout}
              className="rounded-lg border border-border px-3 py-2 text-sm text-text-muted hover:text-red-500 hover:border-red-200 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-8 py-8">
        {showCreate && (
          <div className="mb-8">
            {/* Skill metadata bar */}
            <div className="flex items-center gap-4 mb-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="skill-name"
                className="rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-text placeholder:text-text-muted focus:border-accent focus:outline-none w-48"
              />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short description of this skill..."
                className="flex-1 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
              <button
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 shrink-0"
              >
                {saving ? "Saving..." : editingSkillId ? "Save" : "Create Skill"}
              </button>
            </div>

            {/* VS Code style editor */}
            <div className="flex overflow-hidden rounded-xl border border-border bg-[#1e1e1e]" style={{ height: "560px" }}>
              {/* Sidebar — file explorer */}
              <div
                ref={sidebarRef}
                className="flex w-56 shrink-0 flex-col border-r border-[#333]"
                onContextMenu={(e) => {
                  if (e.target === e.currentTarget || (e.target as HTMLElement).closest("[data-tree-root]")) return;
                  handleContextMenu(e, "");
                }}
              >
                {/* Sidebar header */}
                <div className="flex items-center border-b border-[#333] px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#888]">Explorer</span>
                </div>

                {/* File tree */}
                <div
                  className="flex-1 overflow-y-auto py-1 px-1"
                  data-tree-root
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    handleContextMenu(e, "");
                  }}
                >
                  <div className="mb-1 px-1.5 py-[3px]">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#888]">
                      {name || "my-skill"}
                    </span>
                  </div>
                  {Object.entries(tree)
                    .sort(([, a], [, b]) => {
                      const aIsDir = typeof a !== "string";
                      const bIsDir = typeof b !== "string";
                      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
                      return 0;
                    })
                    .map(([childName, childNode]) => (
                      <TreeNode
                        key={childName}
                        name={childName}
                        node={childNode}
                        depth={0}
                        activeFile={activeFile}
                        onSelect={setActiveFile}
                        onContextMenu={handleContextMenu}
                        expandedFolders={expandedFolders}
                        onToggleFolder={toggleFolder}
                        folderPath={childName}
                      />
                    ))}
                  {/* Inline input for new file/folder */}
                  {inlineInput && (
                    <div className="px-1.5 py-1">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[#888] shrink-0">
                          {inlineInput.type === "folder" ? ">" : ""}
                          {inlineInput.folder ? `${inlineInput.folder}/` : ""}
                        </span>
                        <input
                          type="text"
                          value={inlineValue}
                          onChange={(e) => setInlineValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleInlineSubmit();
                            if (e.key === "Escape") { setInlineInput(null); setInlineValue(""); }
                          }}
                          autoFocus
                          placeholder={inlineInput.type === "folder" ? "folder-name" : "filename.ext"}
                          className="flex-1 min-w-0 rounded border border-accent bg-[#2d2d2d] px-1.5 py-0.5 text-xs font-mono text-[#ccc] placeholder:text-[#555] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Context menu */}
              {ctxMenu && (
                <div
                  className="fixed z-50 min-w-[160px] rounded-lg border border-[#444] bg-[#252526] py-1 shadow-xl"
                  style={{ left: ctxMenu.x, top: ctxMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={ctxNewFile}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#ccc] hover:bg-accent/20 transition-colors"
                  >
                    <span className="w-4 text-center text-[10px] text-[#888]">+</span>
                    New File
                  </button>
                  <button
                    onClick={ctxNewFolder}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#ccc] hover:bg-accent/20 transition-colors"
                  >
                    <span className="w-4 text-center text-[10px] text-[#888]">+</span>
                    New Folder
                  </button>
                  <button
                    onClick={() => { addScaffolding(); setCtxMenu(null); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#ccc] hover:bg-accent/20 transition-colors"
                  >
                    <span className="w-4 text-center text-[10px] text-[#888]">*</span>
                    Add Scaffolding
                  </button>
                  {ctxMenu.targetFile && ctxMenu.targetFile !== "SKILL.md" && (
                    <>
                      <div className="my-1 border-t border-[#444]" />
                      <button
                        onClick={ctxDeleteFile}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <span className="w-4 text-center text-[10px]">x</span>
                        Delete File
                      </button>
                    </>
                  )}
                  {!ctxMenu.targetFile && ctxMenu.targetFolder && (
                    <>
                      <div className="my-1 border-t border-[#444]" />
                      <button
                        onClick={ctxDeleteFolder}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <span className="w-4 text-center text-[10px]">x</span>
                        Delete Folder
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Editor pane */}
              <div className="flex flex-1 flex-col min-w-0">
                {/* Tab bar */}
                <div className="flex items-center border-b border-[#333] bg-[#252526]">
                  <div className="flex items-center gap-0 overflow-x-auto">
                    {files.filter((f) => f.path === activeFile || f.path === "SKILL.md").map((f) => {
                      const fileName = f.path.split("/").pop() || f.path;
                      const isActive = f.path === activeFile;
                      return (
                        <button
                          key={f.path}
                          onClick={() => setActiveFile(f.path)}
                          className={`flex items-center gap-1.5 border-r border-[#333] px-3 py-1.5 text-xs font-mono transition-colors ${
                            isActive
                              ? "bg-[#1e1e1e] text-[#ccc]"
                              : "bg-[#2d2d2d] text-[#888] hover:text-[#ccc]"
                          }`}
                        >
                          <span className="text-[10px]"><FileIcon name={fileName} /></span>
                          {fileName}
                        </button>
                      );
                    })}
                    {activeFile !== "SKILL.md" && !files.some((f) => f.path === activeFile && f.path === "SKILL.md") && (
                      <button
                        key={activeFile}
                        className="flex items-center gap-1.5 border-r border-[#333] px-3 py-1.5 text-xs font-mono bg-[#1e1e1e] text-[#ccc]"
                      >
                        <span className="text-[10px]"><FileIcon name={activeFile.split("/").pop() || activeFile} /></span>
                        {activeFile.split("/").pop()}
                      </button>
                    )}
                  </div>
                  {/* Breadcrumb */}
                  <div className="ml-auto px-3 text-[10px] text-[#666] truncate">
                    {name || "my-skill"} / {activeFile}
                  </div>
                </div>

                {/* Editor area with line numbers */}
                <div className="flex flex-1 overflow-hidden">
                  {/* Line numbers gutter */}
                  <div className="shrink-0 select-none overflow-hidden bg-[#1e1e1e] pt-2 pb-2 text-right">
                    {Array.from({ length: Math.max(lineCount, 20) }, (_, i) => (
                      <div key={i} className="px-3 text-[11px] leading-[18px] text-[#555] font-mono">
                        {i + 1}
                      </div>
                    ))}
                  </div>

                  {/* Text area */}
                  <textarea
                    value={activeContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    spellCheck={false}
                    className="flex-1 resize-none border-0 bg-[#1e1e1e] px-2 pt-2 pb-2 font-mono text-[13px] leading-[18px] text-[#d4d4d4] caret-[#aeafad] focus:outline-none placeholder:text-[#555]"
                    placeholder={activeFile === "SKILL.md" ? "# Skill metadata and instructions..." : `// ${activeFile}`}
                  />
                </div>

                {/* Status bar */}
                <div className="flex items-center justify-between border-t border-[#333] bg-[#007acc] px-3 py-[2px]">
                  <div className="flex items-center gap-3 text-[11px] text-white/90">
                    <span>{name || "my-skill"}</span>
                    <span>{files.length} file{files.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-white/90">
                    <span>Ln {lineCount}</span>
                    <span>{activeExt.toUpperCase() || "TXT"}</span>
                    <span>UTF-8</span>
                    <span>agentskills.io</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {!showCreate && (
          <>
            <p className="mb-6 text-sm text-text-muted">
              Define reusable agent skills in{" "}
              <span className="font-medium text-text">agentskills.io</span> format.
              Each skill is a directory with a <code className="rounded bg-surface-card px-1 py-0.5 text-xs">SKILL.md</code>,
              optional scripts, references, and assets.
            </p>

            {loading ? (
              <div className="py-12 text-center text-text-muted">Loading...</div>
            ) : skills.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface-card py-16 text-center">
                <div className="mb-2 text-4xl text-text-muted">~</div>
                <p className="text-text-muted">No skills yet</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  Create your first skill
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {skills.map((sk) => {
                  const fileList = getFileTree(sk.spec);
                  return (
                    <div
                      key={sk.id}
                      className="group rounded-xl border border-border bg-surface-card p-5 transition-shadow hover:shadow-md"
                    >
                      <div className="mb-1 font-medium text-text">{sk.name}</div>
                      {sk.description && (
                        <p className="mb-3 text-sm text-text-muted line-clamp-2">{sk.description}</p>
                      )}
                      {fileList.length > 0 && (
                        <div className="mb-3 rounded-lg bg-surface px-3 py-2">
                          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">Files</div>
                          <div className="font-mono text-xs text-text-muted space-y-0.5">
                            {fileList.slice(0, 5).map((f) => (
                              <div key={f} className="truncate">{f}</div>
                            ))}
                            {fileList.length > 5 && (
                              <div className="text-text-muted">+{fileList.length - 5} more</div>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleView(sk.id)}
                          className="rounded-lg border border-accent px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-accent/10"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleExport(sk.id, sk.name)}
                          className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text transition-colors hover:bg-surface"
                        >
                          Export
                        </button>
                        <button
                          onClick={() => handleDelete(sk.id, sk.name)}
                          className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
