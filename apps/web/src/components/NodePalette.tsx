"use client";

import { useState } from "react";
import { getNodesByCategory, CATEGORIES } from "@/lib/nodes";
import { NodeTypeInfo, NodeCategory } from "@/lib/types";

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  Triggers: "#22c55e",
  Core: "var(--color-accent)",
  "Control Flow": "#3b82f6",
  Knowledge: "#a855f7",
  "Review/Safety": "#f59e0b",
};

export default function NodePalette() {
  const grouped = getNodesByCategory();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function onDragStart(event: React.DragEvent, nodeType: NodeTypeInfo) {
    event.dataTransfer.setData(
      "application/agent-studio-node",
      JSON.stringify({ type: nodeType.type, config: nodeType.defaultConfig })
    );
    event.dataTransfer.effectAllowed = "move";
  }

  function toggleCategory(category: string) {
    setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));
  }

  const query = search.toLowerCase().trim();

  return (
    <div className="flex h-full w-60 flex-col border-r border-border bg-surface-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold tracking-wide text-text">
          Node Palette
        </h2>
        <button
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-border hover:text-text"
          aria-label="Close palette"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-xs text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {/* Node list */}
      <div className="thin-scrollbar flex-1 overflow-y-auto px-3 pb-3">
        {CATEGORIES.map((category) => {
          const nodes = grouped[category].filter(
            (n) =>
              !query ||
              n.label.toLowerCase().includes(query) ||
              n.description.toLowerCase().includes(query) ||
              n.type.toLowerCase().includes(query)
          );
          if (nodes.length === 0) return null;

          const isCollapsed = collapsed[category] ?? false;
          const borderColor = CATEGORY_COLORS[category];

          return (
            <div key={category} className="mb-2">
              <button
                onClick={() => toggleCategory(category)}
                className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface"
                style={{ backgroundColor: "color-mix(in srgb, var(--color-border) 40%, transparent)" }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="currentColor"
                  className={`shrink-0 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                >
                  <path d="M3 1l5 4-5 4z" />
                </svg>
                {category}
                <span className="ml-auto text-[10px] font-normal opacity-60">
                  {nodes.length}
                </span>
              </button>

              {!isCollapsed && (
                <div className="flex flex-col gap-1">
                  {nodes.map((nodeType) => (
                    <div
                      key={nodeType.type}
                      draggable
                      onDragStart={(e) => onDragStart(e, nodeType)}
                      className="group cursor-grab rounded-md border border-border bg-surface px-2 py-1.5 transition-all duration-100 hover:translate-x-0.5 hover:bg-border/50 active:cursor-grabbing"
                      style={{ borderLeftWidth: "4px", borderLeftColor: borderColor }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm leading-none" role="img" aria-hidden>
                          {nodeType.icon}
                        </span>
                        <span className="text-xs font-bold text-text">
                          {nodeType.label}
                        </span>
                      </div>
                      <div
                        className="mt-0.5 pl-[22px] text-text-muted"
                        style={{ fontSize: "10px", lineHeight: "1.3" }}
                      >
                        {nodeType.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
