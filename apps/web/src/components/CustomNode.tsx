"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { getNodeTypeInfo } from "@/lib/nodes";

const TYPE_ICONS: Record<string, string> = {
  trigger_api: "⚡",
  agent: "🤖",
  transform: "⚙️",
  cli: "❯_",
  tool_call: "🔧",
  router: "🔀",
  classifier: "🏷",
  parallel_fanout: "≣",
  subworkflow: "⧉",
  memory_write: "📝",
  memory_read: "📖",
  knowledge: "📚",
  retrieval: "🔍",
  quality_gate: "✅",
  guardrail: "🛡️",
  approval: "👤",
  end: "🏁",
  jury: "⚖",
  adversarial_debate: "🗣",
  premortem: "⚠",
};

/** Color for the left accent border based on node category */
function getCategoryColor(nodeType: string): string {
  // Triggers
  if (nodeType.startsWith("trigger")) return "#22c55e";
  // Core
  if (["agent", "transform", "cli", "tool_call"].includes(nodeType))
    return "var(--color-accent)";
  // Control Flow
  if (["router", "classifier", "parallel_fanout"].includes(nodeType))
    return "#3b82f6";
  // Quality
  if (
    ["quality_gate", "guardrail", "jury", "adversarial_debate", "premortem"].includes(
      nodeType
    )
  )
    return "#f59e0b";
  // Memory
  if (["memory_read", "memory_write", "knowledge"].includes(nodeType))
    return "#a855f7";
  // Other
  return "var(--color-text-muted)";
}

type CustomNodeData = {
  nodeType: string;
  config: Record<string, unknown>;
  label?: string;
};

function CustomNodeComponent({ data, selected }: NodeProps & { data: CustomNodeData }) {
  const info = getNodeTypeInfo(data.nodeType);
  const icon = TYPE_ICONS[data.nodeType] || "◆";
  const hasMultipleOutputs = info?.outputs && info.outputs.length > 1;
  const configSummary = Object.entries(data.config || {})
    .filter(([, v]) => v !== "" && v !== undefined)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 20) : v}`)
    .join(", ");

  const categoryColor = getCategoryColor(data.nodeType);

  return (
    <div
      className={`rounded-lg border bg-surface-card px-3 py-2 shadow-md transition-transform duration-150 hover:scale-[1.02] ${
        selected ? "ring-2 ring-accent border-accent" : "border-border"
      }`}
      style={{ minWidth: 160, borderLeft: `4px solid ${categoryColor}` }}
    >
      <Handle type="target" position={Position.Top} className="!bg-surface-card !border-accent !border-2 !w-[10px] !h-[10px]" />
      <div className="flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <div className="flex flex-col">
          <span className="text-xs font-semibold uppercase tracking-wide text-text">
            {info?.label || data.nodeType}
          </span>
          <span className="text-[10px] text-text-muted">{data.nodeType}</span>
        </div>
      </div>
      {configSummary && (
        <div className="mt-1 truncate text-xs text-text-muted">{configSummary}</div>
      )}
      {hasMultipleOutputs ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="a"
            className="!bg-surface-card !border-green-500 !border-2 !w-[10px] !h-[10px]"
            style={{ left: "30%" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="b"
            className="!bg-surface-card !border-red-400 !border-2 !w-[10px] !h-[10px]"
            style={{ left: "70%" }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-surface-card !border-accent !border-2 !w-[10px] !h-[10px]" />
      )}
    </div>
  );
}

export default memo(CustomNodeComponent);
