import { NodeTypeInfo, NodeCategory } from "./types";

export const NODE_TYPES: NodeTypeInfo[] = [
  {
    type: "trigger_api",
    label: "API Trigger",
    category: "Triggers",
    description: "HTTP endpoint that starts the workflow",
    icon: "⚡",
    defaultConfig: { method: "POST", path: "/trigger" },
  },
  {
    type: "agent",
    label: "Agent",
    category: "Core",
    description: "LLM agent with a system prompt",
    icon: "🤖",
    defaultConfig: { model: "gpt-4o", prompt: "", temperature: 0.7 },
  },
  {
    type: "transform",
    label: "Transform",
    category: "Core",
    description: "Transform data with an expression",
    icon: "⚙️",
    defaultConfig: { expr: "", as: "result" },
  },
  {
    type: "cli",
    label: "CLI",
    category: "Core",
    description: "Run a shell command",
    icon: "💻",
    defaultConfig: { command: "", timeout: 30 },
  },
  {
    type: "tool_call",
    label: "Tool Call",
    category: "Core",
    description: "Call an external tool or API",
    icon: "🔧",
    defaultConfig: { tool: "", args: {} },
  },
  {
    type: "router",
    label: "Router",
    category: "Control Flow",
    description: "Conditional branch (true/false)",
    icon: "🔀",
    defaultConfig: { when: "" },
    outputs: ["a", "b"],
  },
  {
    type: "classifier",
    label: "Classifier",
    category: "Control Flow",
    description: "Classify input into categories",
    icon: "🏷️",
    defaultConfig: { labels: [], prompt: "" },
  },
  {
    type: "parallel_fanout",
    label: "Parallel Fanout",
    category: "Control Flow",
    description: "Fan out to parallel branches",
    icon: "🔱",
    defaultConfig: { branches: 2 },
  },
  {
    type: "subworkflow",
    label: "Subworkflow",
    category: "Control Flow",
    description: "Run another workflow as a step",
    icon: "📋",
    defaultConfig: { workflow_id: "" },
  },
  {
    type: "memory_write",
    label: "Memory Write",
    category: "Knowledge",
    description: "Write to memory store",
    icon: "✏️",
    defaultConfig: { key: "", value: "" },
  },
  {
    type: "memory_read",
    label: "Memory Read",
    category: "Knowledge",
    description: "Read from memory store",
    icon: "📖",
    defaultConfig: { key: "" },
  },
  {
    type: "retrieval",
    label: "Retrieval",
    category: "Knowledge",
    description: "Retrieve from vector store",
    icon: "📚",
    defaultConfig: { collection: "", query: "", top_k: 5 },
  },
  {
    type: "quality_gate",
    label: "Quality Gate",
    category: "Review/Safety",
    description: "Assert quality conditions",
    icon: "✅",
    defaultConfig: { check: "", threshold: 0.8 },
  },
  {
    type: "guardrail",
    label: "Guardrail",
    category: "Review/Safety",
    description: "Block or redact on regex match",
    icon: "🛡️",
    defaultConfig: { pattern: "", action: "block" },
  },
  {
    type: "approval",
    label: "Approval",
    category: "Review/Safety",
    description: "Pause for human approval",
    icon: "👤",
    defaultConfig: { approvers: [], message: "" },
  },
  {
    type: "end",
    label: "End",
    category: "Control Flow",
    description: "Terminal node",
    icon: "🏁",
    defaultConfig: {},
  },
];

export const CATEGORIES: NodeCategory[] = [
  "Triggers",
  "Core",
  "Control Flow",
  "Knowledge",
  "Review/Safety",
];

export function getNodesByCategory(): Record<NodeCategory, NodeTypeInfo[]> {
  const grouped = {} as Record<NodeCategory, NodeTypeInfo[]>;
  for (const cat of CATEGORIES) {
    grouped[cat] = NODE_TYPES.filter((n) => n.category === cat);
  }
  return grouped;
}

export function getNodeTypeInfo(type: string): NodeTypeInfo | undefined {
  return NODE_TYPES.find((n) => n.type === type);
}
