const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8088";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_token");
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_email");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function login(
  email: string,
  password: string
): Promise<{ token: string; tenant_id: string; role: string; email: string }> {
  const data = await request<{
    token: string;
    tenant_id: string;
    role: string;
    email: string;
  }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem("auth_token", data.token);
  localStorage.setItem("auth_email", data.email);
  return data;
}

export async function fetchNodeCatalog(): Promise<Record<string, unknown>> {
  const data = await request<{ catalog: Record<string, unknown> }>(
    "/api/v1/nodes"
  );
  return data.catalog;
}

export async function createWorkflow(
  name: string,
  spec: { nodes: unknown[]; edges: unknown[] }
): Promise<{ id: string }> {
  return request("/api/v1/workflows", {
    method: "POST",
    body: JSON.stringify({ name, spec }),
  });
}

export async function listWorkflows(): Promise<unknown[]> {
  return request("/api/v1/workflows");
}

export async function getWorkflow(
  id: string
): Promise<{ id: string; name: string; spec: { nodes: unknown[]; edges: unknown[] } }> {
  return request(`/api/v1/workflows/${id}`);
}

export async function compileSpec(spec: {
  nodes: unknown[];
  edges: unknown[];
}): Promise<{ ok: boolean; errors: string[]; layers?: string[][]; unreachable?: string[] }> {
  return request("/api/v1/workflows/compile", {
    method: "POST",
    body: JSON.stringify(spec),
  });
}

export async function updateWorkflow(
  id: string,
  body: { name?: string; spec?: { nodes: unknown[]; edges: unknown[] }; public?: boolean }
): Promise<unknown> {
  return request(`/api/v1/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteWorkflow(id: string): Promise<unknown> {
  return request(`/api/v1/workflows/${id}`, { method: "DELETE" });
}

export async function deployWorkflow(id: string): Promise<unknown> {
  return request(`/api/v1/workflows/${id}/deploy`, { method: "POST" });
}

export async function downloadWorkflowCode(id: string): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api/v1/workflows/${id}/code`, { headers });
  return res.text();
}

export function startRun(
  workflowId: string,
  onEvent: (event: { event: string; data: string }) => void,
  onDone: () => void
): () => void {
  const token = getToken();
  const controller = new AbortController();

  fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          const eventType = line.slice(6).trim();
          const nextLine = lines[lines.indexOf(line) + 1];
          const data = nextLine?.startsWith("data:")
            ? nextLine.slice(5).trim()
            : "";
          onEvent({ event: eventType, data });
        } else if (line.startsWith("data:")) {
          onEvent({ event: "message", data: line.slice(5).trim() });
        }
      }
    }
    onDone();
  }).catch(() => {
    onDone();
  });

  return () => controller.abort();
}

export async function getRunTrace(
  runId: string
): Promise<
  { node: string; type: string; status: string; duration_ms: number }[]
> {
  return request(`/api/v1/runs/${runId}/trace`);
}

export async function getApprovals(
  runId: string
): Promise<unknown[]> {
  return request(`/api/v1/runs/${runId}/approvals`);
}

export async function submitApproval(
  runId: string,
  approved: boolean
): Promise<unknown> {
  return request(`/api/v1/runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify({ approved }),
  });
}

// ----------------------------- LLM Providers -----------------------------
export interface LlmProvider {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  is_default: boolean;
  created_by?: string;
  created_at?: number;
}

export async function listProviders(): Promise<LlmProvider[]> {
  return request("/api/v1/settings/providers");
}

export async function createProvider(body: {
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  is_default: boolean;
}): Promise<LlmProvider> {
  return request("/api/v1/settings/providers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateProvider(
  id: string,
  body: {
    name?: string;
    provider_type?: string;
    base_url?: string;
    api_key?: string;
    is_default?: boolean;
  }
): Promise<LlmProvider> {
  return request(`/api/v1/settings/providers/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteProvider(id: string): Promise<unknown> {
  return request(`/api/v1/settings/providers/${id}`, { method: "DELETE" });
}

export async function testProvider(
  id: string
): Promise<{ status: string; message: string }> {
  return request(`/api/v1/settings/providers/${id}/test`, { method: "POST" });
}

// ----------------------------- Runs -----------------------------
export interface RunSummary {
  id: string;
  workflow_id: string;
  status: string;
  started_at: number;
  finished_at: number;
  error_message: string;
}

export async function listRuns(
  opts?: { workflow_id?: string; limit?: number; offset?: number }
): Promise<RunSummary[]> {
  const params = new URLSearchParams();
  if (opts?.workflow_id) params.set("workflow_id", opts.workflow_id);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return request(`/api/v1/runs${qs ? `?${qs}` : ""}`);
}

// ----------------------------- MCP Servers -----------------------------
export interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: string;
  auth_header: string;
  headers: Record<string, string>;
  tools: { name: string; description?: string }[];
  status: string;
  created_by?: string;
  created_at?: number;
}

export async function listMcpServers(): Promise<McpServer[]> {
  return request("/api/v1/mcp-servers");
}

export async function registerMcpServer(body: {
  name: string;
  url: string;
  transport?: string;
  auth_header?: string;
  headers?: Record<string, string>;
}): Promise<McpServer> {
  return request("/api/v1/mcp-servers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteMcpServer(id: string): Promise<unknown> {
  return request(`/api/v1/mcp-servers/${id}`, { method: "DELETE" });
}

export async function pingMcpServer(
  id: string
): Promise<{ status: string; tools?: unknown[]; tools_count?: number; error?: string }> {
  return request(`/api/v1/mcp-servers/${id}/ping`, { method: "POST" });
}

// ----------------------------- Skills -----------------------------
export interface Skill {
  id: string;
  name: string;
  description: string;
  spec: Record<string, unknown>;
  created_by?: string;
  created_at?: number;
}

export async function listSkills(): Promise<Skill[]> {
  return request("/api/v1/skills");
}

export async function getSkill(id: string): Promise<Skill> {
  return request(`/api/v1/skills/${id}`);
}

export async function createSkill(body: {
  name: string;
  description?: string;
  spec: Record<string, unknown>;
}): Promise<Skill> {
  return request("/api/v1/skills", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateSkill(
  id: string,
  body: { name?: string; description?: string; spec?: Record<string, unknown> }
): Promise<Skill> {
  return request(`/api/v1/skills/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteSkill(id: string): Promise<unknown> {
  return request(`/api/v1/skills/${id}`, { method: "DELETE" });
}

export async function exportSkill(id: string): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api/v1/skills/${id}/export`, { headers });
  return res.text();
}
