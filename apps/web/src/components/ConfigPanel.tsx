"use client";

import { getNodeTypeInfo } from "@/lib/nodes";
import type { Node } from "@xyflow/react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConfigPanelProps {
  node: Node | null;
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
}

interface PropertySchema {
  type?: string;
  enum?: string[];
  description?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  default?: unknown;
}

interface JsonSchema {
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MULTILINE_KEYS = new Set(["prompt", "expr", "command", "pattern"]);

const INPUT_CLS =
  "w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent";
const TEXTAREA_CLS =
  "w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-accent";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ConfigPanel({
  node,
  onConfigChange,
  onDelete,
}: ConfigPanelProps) {
  if (!node) {
    return (
      <div className="flex h-full w-64 items-center justify-center border-l border-border bg-surface-card p-4 text-sm text-text-muted">
        Select a node to configure
      </div>
    );
  }

  const data = node.data as {
    nodeType: string;
    config: Record<string, unknown>;
    configSchema?: Record<string, unknown>;
  };
  const info = getNodeTypeInfo(data.nodeType);
  const config = data.config || {};
  const configSchema = data.configSchema as JsonSchema | undefined;

  function handleChange(key: string, value: unknown) {
    onConfigChange(node!.id, { ...config, [key]: value });
  }

  /* ---------- fallback: typeof-based rendering (original) ---------- */

  function renderFieldFallback(key: string, value: unknown) {
    if (Array.isArray(value)) {
      return (
        <textarea
          value={JSON.stringify(value, null, 2)}
          onChange={(e) => {
            try {
              handleChange(key, JSON.parse(e.target.value));
            } catch {
              /* ignore invalid json while typing */
            }
          }}
          className={TEXTAREA_CLS}
          rows={3}
        />
      );
    }
    if (typeof value === "object" && value !== null) {
      return (
        <textarea
          value={JSON.stringify(value, null, 2)}
          onChange={(e) => {
            try {
              handleChange(key, JSON.parse(e.target.value));
            } catch {
              /* ignore */
            }
          }}
          className={TEXTAREA_CLS}
          rows={3}
        />
      );
    }
    if (typeof value === "number") {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => handleChange(key, parseFloat(e.target.value) || 0)}
          className={INPUT_CLS}
        />
      );
    }
    if (typeof value === "boolean") {
      return (
        <select
          value={value ? "true" : "false"}
          onChange={(e) => handleChange(key, e.target.value === "true")}
          className={INPUT_CLS}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    if (MULTILINE_KEYS.has(key)) {
      return (
        <textarea
          value={String(value ?? "")}
          onChange={(e) => handleChange(key, e.target.value)}
          className={INPUT_CLS}
          rows={4}
        />
      );
    }
    return (
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => handleChange(key, e.target.value)}
        className={INPUT_CLS}
      />
    );
  }

  /* ---------- schema-driven rendering ------------------------------ */

  function renderSchemaField(key: string, prop: PropertySchema, value: unknown) {
    const schemaType = prop.type;

    // string with enum -> select dropdown
    if (schemaType === "string" && prop.enum) {
      return (
        <select
          value={String(value ?? prop.default ?? "")}
          onChange={(e) => handleChange(key, e.target.value)}
          className={INPUT_CLS}
        >
          {prop.enum.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // string -> textarea or input
    if (schemaType === "string") {
      const isMultiline =
        MULTILINE_KEYS.has(key) || prop.format === "multiline";
      if (isMultiline) {
        return (
          <textarea
            value={String(value ?? prop.default ?? "")}
            onChange={(e) => handleChange(key, e.target.value)}
            className={INPUT_CLS}
            rows={4}
          />
        );
      }
      return (
        <input
          type="text"
          value={String(value ?? prop.default ?? "")}
          onChange={(e) => handleChange(key, e.target.value)}
          className={INPUT_CLS}
        />
      );
    }

    // number / integer
    if (schemaType === "number" || schemaType === "integer") {
      return (
        <input
          type="number"
          value={value != null ? Number(value) : (prop.default as number) ?? ""}
          onChange={(e) => {
            const parsed =
              schemaType === "integer"
                ? parseInt(e.target.value, 10)
                : parseFloat(e.target.value);
            handleChange(key, Number.isNaN(parsed) ? 0 : parsed);
          }}
          min={prop.minimum}
          max={prop.maximum}
          step={prop.step ?? (schemaType === "integer" ? 1 : undefined)}
          className={INPUT_CLS}
        />
      );
    }

    // boolean
    if (schemaType === "boolean") {
      const boolVal =
        value != null ? Boolean(value) : (prop.default as boolean) ?? false;
      return (
        <select
          value={boolVal ? "true" : "false"}
          onChange={(e) => handleChange(key, e.target.value === "true")}
          className={INPUT_CLS}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }

    // array or object -> JSON textarea
    if (schemaType === "array" || schemaType === "object") {
      const jsonVal = value ?? prop.default ?? (schemaType === "array" ? [] : {});
      return (
        <textarea
          value={JSON.stringify(jsonVal, null, 2)}
          onChange={(e) => {
            try {
              handleChange(key, JSON.parse(e.target.value));
            } catch {
              /* ignore invalid json while typing */
            }
          }}
          className={TEXTAREA_CLS}
          rows={3}
        />
      );
    }

    // unknown schema type -> fallback to text input
    return (
      <input
        type="text"
        value={String(value ?? prop.default ?? "")}
        onChange={(e) => handleChange(key, e.target.value)}
        className={INPUT_CLS}
      />
    );
  }

  /* ---------- choose rendering strategy ---------------------------- */

  const hasSchema =
    configSchema && configSchema.properties && Object.keys(configSchema.properties).length > 0;

  const requiredSet = new Set<string>(configSchema?.required ?? []);

  return (
    <div className="flex h-full w-64 flex-col overflow-y-auto border-l border-border bg-surface-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{info?.label || data.nodeType}</h2>
        <button
          onClick={() => onDelete(node.id)}
          className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-xs text-text-muted">Node ID</label>
        <div className="rounded border border-border bg-surface px-2 py-1 font-mono text-xs">
          {node.id}
        </div>
      </div>

      {hasSchema
        ? Object.entries(configSchema!.properties!).map(([key, prop]) => (
            <div key={key} className="mb-3">
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {key}
                {requiredSet.has(key) && (
                  <span className="text-red-500"> *</span>
                )}
              </label>
              {renderSchemaField(key, prop, config[key])}
              {prop.description && (
                <p className="text-[10px] text-text-muted mt-0.5">
                  {prop.description}
                </p>
              )}
            </div>
          ))
        : Object.entries(config).map(([key, value]) => (
            <div key={key} className="mb-3">
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {key}
              </label>
              {renderFieldFallback(key, value)}
            </div>
          ))}
    </div>
  );
}
