"use client";

import { getNodeTypeInfo } from "@/lib/nodes";
import { ConfigFieldSchema } from "@/lib/types";
import type { Node } from "@xyflow/react";

interface ConfigPanelProps {
  node: Node | null;
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
}

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
    configSchema?: { type: string; properties: Record<string, ConfigFieldSchema> };
  };
  const info = getNodeTypeInfo(data.nodeType);
  const config = data.config || {};
  const schema = data.configSchema?.properties;

  function handleChange(key: string, value: unknown) {
    onConfigChange(node!.id, { ...config, [key]: value });
  }

  function renderSchemaField(key: string, fieldSchema: ConfigFieldSchema, value: unknown) {
    if (fieldSchema.enum) {
      return (
        <select
          value={String(value ?? fieldSchema.default ?? "")}
          onChange={(e) => handleChange(key, e.target.value)}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        >
          {fieldSchema.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }
    if (fieldSchema.type === "boolean") {
      return (
        <select
          value={String(value ?? fieldSchema.default ?? false)}
          onChange={(e) => handleChange(key, e.target.value === "true")}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    if (fieldSchema.type === "number" || fieldSchema.type === "integer") {
      return (
        <input
          type="number"
          value={value as number ?? fieldSchema.default ?? 0}
          onChange={(e) => handleChange(key, parseFloat(e.target.value) || 0)}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        />
      );
    }
    if (fieldSchema.type === "array") {
      return (
        <textarea
          value={JSON.stringify(value ?? fieldSchema.default ?? [], null, 2)}
          onChange={(e) => {
            try { handleChange(key, JSON.parse(e.target.value)); } catch { /* typing */ }
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-accent"
          rows={3}
        />
      );
    }
    if (fieldSchema.type === "object") {
      return (
        <textarea
          value={JSON.stringify(value ?? fieldSchema.default ?? {}, null, 2)}
          onChange={(e) => {
            try { handleChange(key, JSON.parse(e.target.value)); } catch { /* typing */ }
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-accent"
          rows={3}
        />
      );
    }
    const isLongText = key === "prompt" || key === "expr" || key === "command" || key === "pattern";
    if (isLongText) {
      return (
        <textarea
          value={String(value ?? fieldSchema.default ?? "")}
          onChange={(e) => handleChange(key, e.target.value)}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
          rows={4}
        />
      );
    }
    return (
      <input
        type="text"
        value={String(value ?? fieldSchema.default ?? "")}
        onChange={(e) => handleChange(key, e.target.value)}
        className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
      />
    );
  }

  function renderInferredField(key: string, value: unknown) {
    if (Array.isArray(value)) {
      return (
        <textarea
          value={JSON.stringify(value, null, 2)}
          onChange={(e) => {
            try { handleChange(key, JSON.parse(e.target.value)); } catch { /* typing */ }
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-accent"
          rows={3}
        />
      );
    }
    if (typeof value === "object" && value !== null) {
      return (
        <textarea
          value={JSON.stringify(value, null, 2)}
          onChange={(e) => {
            try { handleChange(key, JSON.parse(e.target.value)); } catch { /* typing */ }
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-accent"
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
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        />
      );
    }
    if (typeof value === "boolean") {
      return (
        <select
          value={value ? "true" : "false"}
          onChange={(e) => handleChange(key, e.target.value === "true")}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    const isLongText = key === "prompt" || key === "expr" || key === "command" || key === "pattern";
    if (isLongText) {
      return (
        <textarea
          value={String(value ?? "")}
          onChange={(e) => handleChange(key, e.target.value)}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
          rows={4}
        />
      );
    }
    return (
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => handleChange(key, e.target.value)}
        className="w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
      />
    );
  }

  const fieldKeys = schema
    ? Object.keys(schema)
    : Object.keys(config);

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
      {fieldKeys.map((key) => (
        <div key={key} className="mb-3">
          <label className="mb-1 block text-xs font-medium text-text-muted">
            {key}
            {schema?.[key]?.description && (
              <span className="ml-1 font-normal text-text-muted" title={schema[key].description}>
                ?
              </span>
            )}
          </label>
          {schema?.[key]
            ? renderSchemaField(key, schema[key], config[key])
            : renderInferredField(key, config[key])}
        </div>
      ))}
    </div>
  );
}
