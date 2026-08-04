export interface WorkflowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface WorkflowSpec {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  spec: WorkflowSpec;
  tenant_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CompileResult {
  ok: boolean;
  errors: string[];
  layers?: string[][];
  unreachable?: string[];
}

/** Per-node compile diagnostics passed to canvas nodes. */
export type NodeErrorMap = Map<string, { errors: string[]; unreachable: boolean }>;

export interface RunEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface TraceSpan {
  node: string;
  type: string;
  status: string;
  duration_ms: number;
}

export interface AuthResponse {
  token: string;
  tenant_id: string;
  role: string;
  email: string;
}

export interface Approval {
  node_id: string;
  run_id: string;
  payload: Record<string, unknown>;
}

export type NodeCategory = "Triggers" | "Core" | "Control Flow" | "Knowledge" | "Review/Safety";

export interface NodeTypeInfo {
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  icon: string;
  defaultConfig: Record<string, unknown>;
  outputs?: string[];
}
