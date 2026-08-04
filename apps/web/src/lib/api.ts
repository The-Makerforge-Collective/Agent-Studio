const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8088";

const API_URL = BASE_URL;

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
}): Promise<{ ok: boolean; errors: string[]; layers?: string[][] }> {
  return request("/api/v1/workflows/compile", {
    method: "POST",
    body: JSON.stringify(spec),
  });
}

export async function deployWorkflow(id: string): Promise<unknown> {
  return request(`/api/v1/workflows/${id}/deploy`, { method: "POST" });
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

export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch(`${API_URL}/health`);
  return res.json();
}
