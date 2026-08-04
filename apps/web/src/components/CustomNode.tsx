"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { getNodeTypeInfo } from "@/lib/nodes";

const TYPE_ICONS: Record<string, string> = {
  trigger_api: "▶",
  agent: "🧠",
  transform: "⇄",
  cli: "❯_",
  tool_call: "🔧",
  router: "⎇",
  classifier: "🏷",
  parallel_fanout: "≣",
  subworkflow: "⧉",
  memory_write: "📝",
  memory_read: "📖",
  retrieval: "🔍",
  quality_gate: "✓",
  guardrail: "🛡",
  approval: "✋",
  end: "⬛",
};

type CustomNodeData = {
  nodeType: string;
  config: Record<string, unknown>;
  label?: string;
  _compileErrors?: string[];
  _unreachable?: boolean;
};

function CustomNodeComponent({ data, selected }: NodeProps & { data: CustomNodeData }) {
  const info = getNodeTypeInfo(data.nodeType);
  const icon = TYPE_ICONS[data.nodeType] || "●";
  const hasMultipleOutputs = info?.outputs && info.outputs.length > 1;
  const configSummary = Object.entries(data.config || {})
    .filter(([, v]) => v !== "" && v !== undefined)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 20) : v}`)
    .join(", ");

  const hasErrors = data._compileErrors && data._compileErrors.length > 0;
  const isUnreachable = data._unreachable === true;

  // Determine border class: errors (red) take priority over unreachable (amber)
  let borderClass: string;
  if (hasErrors) {
    borderClass = "border-red-500 border-2 shadow-md";
  } else if (isUnreachable) {
    borderClass = "border-amber-400 border-2 shadow-md";
  } else if (selected) {
    borderClass = "border-accent shadow-md";
  } else {
    borderClass = "border-border";
  }

  return (
    <div
      className={`rounded-lg border bg-surface-card px-3 py-2 shadow-sm transition-shadow ${borderClass}`}
      style={{ minWidth: 160 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {info?.label || data.nodeType}
        </span>
      </div>
      {configSummary && (
        <div className="mt-1 truncate text-xs text-text-muted">{configSummary}</div>
      )}
      {hasErrors && (
        <div
          className="mt-1 truncate rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-600"
          title={data._compileErrors!.join("\n")}
        >
          {data._compileErrors![0]}
        </div>
      )}
      {isUnreachable && !hasErrors && (
        <div className="mt-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-xs text-amber-600">
          unreachable
        </div>
      )}
      {hasMultipleOutputs ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="a"
            className="!bg-green-500 !w-2 !h-2"
            style={{ left: "30%" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="b"
            className="!bg-red-400 !w-2 !h-2"
            style={{ left: "70%" }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2" />
      )}
    </div>
  );
}

export default memo(CustomNodeComponent);
