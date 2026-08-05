"use client";

import { useState, useEffect } from "react";
import { fetchNodeCatalog, CatalogEntry } from "@/lib/api";
import { getNodesByCategory, CATEGORIES } from "@/lib/nodes";
import { NodeCategory } from "@/lib/types";

interface PaletteNode {
  type: string;
  label: string;
  category: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  configSchema?: CatalogEntry["config_schema"];
}

function catalogToGrouped(entries: CatalogEntry[]): Record<string, PaletteNode[]> {
  const grouped: Record<string, PaletteNode[]> = {};
  for (const entry of entries) {
    const defaults: Record<string, unknown> = {};
    if (entry.config_schema?.properties) {
      for (const [k, v] of Object.entries(entry.config_schema.properties)) {
        if (v.default !== undefined) defaults[k] = v.default;
        else if (v.type === "string") defaults[k] = "";
        else if (v.type === "number" || v.type === "integer") defaults[k] = 0;
        else if (v.type === "boolean") defaults[k] = false;
        else if (v.type === "array") defaults[k] = [];
        else if (v.type === "object") defaults[k] = {};
      }
    }
    const cat = entry.category || "Core";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      type: entry.type,
      label: entry.label || entry.type,
      category: cat,
      description: entry.description || "",
      defaultConfig: defaults,
      configSchema: entry.config_schema,
    });
  }
  return grouped;
}

export default function NodePalette() {
  const [grouped, setGrouped] = useState<Record<string, PaletteNode[]> | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchNodeCatalog()
      .then((catalog) => {
        if (cancelled) return;
        const g = catalogToGrouped(catalog);
        const cats = CATEGORIES.filter((c) => g[c]?.length);
        const extra = Object.keys(g).filter((c) => !cats.includes(c as NodeCategory));
        setGrouped(g);
        setCategories([...cats, ...extra]);
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = getNodesByCategory();
        const g: Record<string, PaletteNode[]> = {};
        for (const [cat, nodes] of Object.entries(fallback)) {
          g[cat] = nodes.map((n) => ({
            type: n.type,
            label: n.label,
            category: cat,
            description: n.description,
            defaultConfig: n.defaultConfig,
          }));
        }
        setGrouped(g);
        setCategories([...CATEGORIES]);
      });
    return () => { cancelled = true; };
  }, []);

  function onDragStart(event: React.DragEvent, node: PaletteNode) {
    event.dataTransfer.setData(
      "application/agent-studio-node",
      JSON.stringify({
        type: node.type,
        config: node.defaultConfig,
        configSchema: node.configSchema,
      })
    );
    event.dataTransfer.effectAllowed = "move";
  }

  if (!grouped) {
    return (
      <div className="flex h-full w-56 items-center justify-center border-r border-border bg-surface-card p-3 text-xs text-text-muted">
        Loading nodes...
      </div>
    );
  }

  return (
    <div className="flex h-full w-56 flex-col overflow-y-auto border-r border-border bg-surface-card p-3">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">
        Nodes
      </h2>
      {categories.map((category) => (
        <div key={category} className="mb-4">
          <h3 className="mb-1 text-xs font-semibold text-text-muted">
            {category}
          </h3>
          {(grouped[category] || []).map((node) => (
            <div
              key={node.type}
              draggable
              onDragStart={(e) => onDragStart(e, node)}
              className="mb-1 cursor-grab rounded border border-border bg-surface px-2 py-1.5 text-xs hover:border-accent active:cursor-grabbing"
            >
              <div className="font-medium">{node.label}</div>
              <div className="text-text-muted" style={{ fontSize: "10px" }}>
                {node.description}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
