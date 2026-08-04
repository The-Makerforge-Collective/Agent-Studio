import { NodeTypeInfo, NodeCategory, NodeCatalogEntry } from "./types";
import { fetchNodeCatalog } from "./api";

export const NODE_TYPES: NodeTypeInfo[] = [
  {
    type: "trigger_api",
    label: "API Trigger",
    category: "Triggers",
    description: "HTTP endpoint that starts the workflow",
    defaultConfig: { method: "POST", path: "/trigger" },
  },
  {
    type: "agent",
    label: "Agent",
    category: "Core",
    description: "LLM agent with a system prompt",
    defaultConfig: { model: "gpt-4o", prompt: "", temperature: 0.7 },
  },
  {
    type: "transform",
    label: "Transform",
    category: "Core",
    description: "Transform data with an expression",
    defaultConfig: { expr: "", as: "result" },
  },
  {
    type: "cli",
    label: "CLI",
    category: "Core",
    description: "Run a shell command",
    defaultConfig: { command: "", timeout: 30 },
  },
  {
    type: "tool_call",
    label: "Tool Call",
    category: "Core",
    description: "Call an external tool or API",
    defaultConfig: { tool: "", args: {} },
  },
  {
    type: "router",
    label: "Router",
    category: "Control Flow",
    description: "Conditional branch (true/false)",
    defaultConfig: { when: "" },
    outputs: ["a", "b"],
  },
  {
    type: "classifier",
    label: "Classifier",
    category: "Control Flow",
    description: "Classify input into categories",
    defaultConfig: { labels: [], prompt: "" },
  },
  {
    type: "parallel_fanout",
    label: "Parallel Fanout",
    category: "Control Flow",
    description: "Fan out to parallel branches",
    defaultConfig: { branches: 2 },
  },
  {
    type: "subworkflow",
    label: "Subworkflow",
    category: "Control Flow",
    description: "Run another workflow as a step",
    defaultConfig: { workflow_id: "" },
  },
  {
    type: "memory_write",
    label: "Memory Write",
    category: "Knowledge",
    description: "Write to memory store",
    defaultConfig: { key: "", value: "" },
  },
  {
    type: "memory_read",
    label: "Memory Read",
    category: "Knowledge",
    description: "Read from memory store",
    defaultConfig: { key: "" },
  },
  {
    type: "retrieval",
    label: "Retrieval",
    category: "Knowledge",
    description: "Retrieve from vector store",
    defaultConfig: { collection: "", query: "", top_k: 5 },
  },
  {
    type: "quality_gate",
    label: "Quality Gate",
    category: "Review/Safety",
    description: "Assert quality conditions",
    defaultConfig: { check: "", threshold: 0.8 },
  },
  {
    type: "guardrail",
    label: "Guardrail",
    category: "Review/Safety",
    description: "Block or redact on regex match",
    defaultConfig: { pattern: "", action: "block" },
  },
  {
    type: "approval",
    label: "Approval",
    category: "Review/Safety",
    description: "Pause for human approval",
    defaultConfig: { approvers: [], message: "" },
  },
  {
    type: "end",
    label: "End",
    category: "Control Flow",
    description: "Terminal node",
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

let catalogCache: NodeTypeInfo[] | null = null;

function labelFromType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function categoryFromType(type: string): NodeCategory {
  if (type.startsWith("trigger")) return "Triggers";
  if (
    type === "router" ||
    type === "classifier" ||
    type === "parallel_fanout" ||
    type === "subworkflow" ||
    type === "end"
  )
    return "Control Flow";
  if (type.startsWith("memory") || type === "retrieval") return "Knowledge";
  if (
    type === "quality_gate" ||
    type === "guardrail" ||
    type === "approval"
  )
    return "Review/Safety";
  return "Core";
}

function extractDefaults(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const properties = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) return defaults;
  for (const [key, prop] of Object.entries(properties)) {
    if (prop && "default" in prop) {
      defaults[key] = prop.default;
    }
  }
  return defaults;
}

function mapCatalogEntry(entry: NodeCatalogEntry): NodeTypeInfo {
  return {
    type: entry.type,
    label: labelFromType(entry.type),
    category: categoryFromType(entry.type),
    description: entry.description,
    defaultConfig: extractDefaults(entry.config_schema),
    outputs: entry.outputs.length > 0 ? entry.outputs : undefined,
    configSchema: entry.config_schema,
  };
}

export async function loadNodeCatalog(): Promise<NodeTypeInfo[]> {
  if (catalogCache) return catalogCache;
  try {
    const entries = await fetchNodeCatalog();
    catalogCache = entries.map(mapCatalogEntry);
    return catalogCache;
  } catch {
    return NODE_TYPES;
  }
}
