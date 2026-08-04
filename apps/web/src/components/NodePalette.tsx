"use client";

import { getNodesByCategory, CATEGORIES } from "@/lib/nodes";
import { NodeTypeInfo } from "@/lib/types";

export default function NodePalette() {
  const grouped = getNodesByCategory();

  function onDragStart(event: React.DragEvent, nodeType: NodeTypeInfo) {
    event.dataTransfer.setData(
      "application/agent-studio-node",
      JSON.stringify({ type: nodeType.type, config: nodeType.defaultConfig })
    );
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="flex h-full w-56 flex-col overflow-y-auto border-r border-border bg-surface-card p-3">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">
        Nodes
      </h2>
      {CATEGORIES.map((category) => (
        <div key={category} className="mb-4">
          <h3 className="mb-1 text-xs font-semibold text-text-muted">
            {category}
          </h3>
          {grouped[category].map((nodeType) => (
            <div
              key={nodeType.type}
              draggable
              onDragStart={(e) => onDragStart(e, nodeType)}
              className="mb-1 cursor-grab rounded border border-border bg-surface px-2 py-1.5 text-xs hover:border-accent active:cursor-grabbing"
            >
              <div className="font-medium">{nodeType.label}</div>
              <div className="text-text-muted" style={{ fontSize: "10px" }}>
                {nodeType.description}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
