"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAuthenticated, logout } from "@/lib/auth";
import {
  listMcpServers,
  registerMcpServer,
  deleteMcpServer,
  pingMcpServer,
  McpServer,
} from "@/lib/api";

type AuthType =
  | "none"
  | "oauth2"
  | "bearer"
  | "api-key"
  | "basic"
  | "mtls"
  | "custom-header";

interface AuthConfig {
  type: AuthType;
  // Bearer
  token?: string;
  // API Key
  apiKey?: string;
  apiKeyHeader?: string;
  apiKeyIn?: "header" | "query";
  // Basic
  username?: string;
  password?: string;
  // OAuth 2.1 (MCP spec)
  oauth2AuthUrl?: string;
  oauth2TokenUrl?: string;
  oauth2ClientId?: string;
  oauth2ClientSecret?: string;
  oauth2Scope?: string;
  oauth2GrantType?: "authorization_code" | "client_credentials";
  oauth2Pkce?: boolean;
  oauth2ResourceMetadataUrl?: string;
  // mTLS / Client Certificates
  mtlsCert?: string;
  mtlsKey?: string;
  mtlsCa?: string;
  // Custom header
  customHeaderName?: string;
  customHeaderValue?: string;
}

function buildAuthPayload(auth: AuthConfig): {
  auth_header: string;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  let auth_header = "";

  switch (auth.type) {
    case "bearer":
      auth_header = `Bearer ${auth.token || ""}`;
      break;
    case "api-key":
      if (auth.apiKeyIn === "query") {
        headers["X-API-Key-Param"] = auth.apiKeyHeader || "api_key";
        headers["X-API-Key-Value"] = auth.apiKey || "";
      } else {
        headers[auth.apiKeyHeader || "X-API-Key"] = auth.apiKey || "";
      }
      break;
    case "basic": {
      const encoded =
        typeof window !== "undefined"
          ? btoa(`${auth.username || ""}:${auth.password || ""}`)
          : "";
      auth_header = `Basic ${encoded}`;
      break;
    }
    case "oauth2":
      headers["X-Auth-Type"] = "oauth2";
      headers["X-OAuth2-Grant-Type"] = auth.oauth2GrantType || "client_credentials";
      if (auth.oauth2AuthUrl) headers["X-OAuth2-Auth-URL"] = auth.oauth2AuthUrl;
      if (auth.oauth2TokenUrl) headers["X-OAuth2-Token-URL"] = auth.oauth2TokenUrl;
      if (auth.oauth2ClientId) headers["X-OAuth2-Client-ID"] = auth.oauth2ClientId;
      if (auth.oauth2ClientSecret) headers["X-OAuth2-Client-Secret"] = auth.oauth2ClientSecret;
      if (auth.oauth2Scope) headers["X-OAuth2-Scope"] = auth.oauth2Scope;
      if (auth.oauth2Pkce) headers["X-OAuth2-PKCE"] = "true";
      if (auth.oauth2ResourceMetadataUrl) headers["X-OAuth2-Resource-Metadata"] = auth.oauth2ResourceMetadataUrl;
      break;
    case "mtls":
      headers["X-Auth-Type"] = "mtls";
      if (auth.mtlsCert) headers["X-mTLS-Cert"] = auth.mtlsCert;
      if (auth.mtlsKey) headers["X-mTLS-Key"] = auth.mtlsKey;
      if (auth.mtlsCa) headers["X-mTLS-CA"] = auth.mtlsCa;
      break;
    case "custom-header":
      if (auth.customHeaderName)
        headers[auth.customHeaderName] = auth.customHeaderValue || "";
      break;
  }
  return { auth_header, headers };
}

const AUTH_OPTIONS: { type: AuthType; label: string; description: string }[] = [
  { type: "none", label: "None", description: "No authentication required" },
  { type: "oauth2", label: "OAuth 2.1", description: "MCP spec authorization with PKCE, RFC 9728 discovery" },
  { type: "bearer", label: "Bearer Token", description: "Static bearer token in Authorization header" },
  { type: "api-key", label: "API Key", description: "Key in custom header or query parameter" },
  { type: "basic", label: "Basic Auth", description: "Username and password (RFC 7617)" },
  { type: "mtls", label: "mTLS / Client Cert", description: "Mutual TLS with client certificates" },
  { type: "custom-header", label: "Custom Header", description: "Arbitrary header name and value" },
];

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
  hint,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  hint?: string;
  rows?: number;
}) {
  const cls = `w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none ${mono ? "font-mono text-xs" : ""}`;
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-text">{label}</label>
      {rows ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={cls + " resize-none"} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
      {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

export default function McpServersPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState("streamable-http");
  const [auth, setAuth] = useState<AuthConfig>({ type: "none" });
  const [saving, setSaving] = useState(false);
  const [pinging, setPinging] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
    refresh();
  }, []);

  function refresh() {
    listMcpServers()
      .then(setServers)
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  }

  async function handleRegister() {
    if (!name.trim() || !url.trim()) return;
    setSaving(true);
    const { auth_header, headers } = buildAuthPayload(auth);
    try {
      await registerMcpServer({
        name: name.trim(),
        url: url.trim(),
        transport,
        auth_header,
        headers,
      });
      setName("");
      setUrl("");
      setAuth({ type: "none" });
      setShowRegister(false);
      refresh();
    } catch {
      alert("Failed to register MCP server");
    } finally {
      setSaving(false);
    }
  }

  async function handlePing(id: string) {
    setPinging(id);
    try {
      const result = await pingMcpServer(id);
      if (result.status === "connected") {
        alert(`Connected! Discovered ${result.tools_count} tool(s).`);
      } else {
        alert(`Connection failed: ${result.error}`);
      }
      refresh();
    } catch {
      alert("Ping failed");
    } finally {
      setPinging(null);
    }
  }

  async function handleDelete(id: string, serverName: string) {
    if (!confirm(`Remove MCP server "${serverName}"?`)) return;
    try {
      await deleteMcpServer(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert("Failed to delete MCP server");
    }
  }

  function statusBadge(status: string) {
    const colors: Record<string, string> = {
      connected: "bg-green-100 text-green-700",
      error: "bg-red-100 text-red-700",
      pending: "bg-yellow-100 text-yellow-700",
    };
    return (
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
          colors[status] || "bg-gray-100 text-gray-600"
        }`}
      >
        {status}
      </span>
    );
  }

  function updateAuth<K extends keyof AuthConfig>(key: K, value: AuthConfig[K]) {
    setAuth((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="dashboard-fade-in min-h-screen bg-surface">
      <header className="border-b border-border bg-surface-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-5">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white text-sm font-bold">A</div>
              <span className="text-lg font-semibold text-text">Agent Studio</span>
            </Link>
            <span className="text-text-muted">/</span>
            <span className="text-lg font-semibold text-text">MCP Servers</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowRegister(!showRegister)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              {showRegister ? "Cancel" : "Register Server"}
            </button>
            <button
              onClick={logout}
              className="rounded-lg border border-border px-3 py-2 text-sm text-text-muted hover:text-red-500 hover:border-red-200 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-8">
        <p className="mb-6 text-sm text-text-muted">
          Register remote{" "}
          <span className="font-medium text-text">MCP</span> (Model Context Protocol) servers.
          Supports{" "}
          <span className="font-medium text-text">OAuth 2.1</span> with PKCE per the MCP authorization spec,
          plus bearer tokens, API keys, basic auth, mTLS, and custom headers.
        </p>

        {showRegister && (
          <div className="mb-8 rounded-xl border border-border bg-surface-card p-6">
            <h2 className="mb-4 text-lg font-semibold text-text">Register MCP Server</h2>
            <div className="space-y-5">
              {/* Connection */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <InputField label="Name" value={name} onChange={setName} placeholder="e.g. github-tools" />
                <div>
                  <label className="mb-1 block text-sm font-medium text-text">Transport</label>
                  <select
                    value={transport}
                    onChange={(e) => setTransport(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                  >
                    <option value="streamable-http">Streamable HTTP</option>
                    <option value="sse">SSE (Server-Sent Events)</option>
                    <option value="stdio">Stdio</option>
                  </select>
                </div>
                <InputField label="URL" value={url} onChange={setUrl} placeholder="https://mcp.example.com/mcp" />
              </div>

              {/* Auth method selector */}
              <div>
                <label className="mb-2 block text-sm font-medium text-text">Authentication Method</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {AUTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => setAuth({ type: opt.type })}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        auth.type === opt.type
                          ? "border-accent bg-accent/5 ring-1 ring-accent/20"
                          : "border-border hover:border-text-muted"
                      }`}
                    >
                      <div className={`text-sm font-medium ${auth.type === opt.type ? "text-accent" : "text-text"}`}>
                        {opt.label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-text-muted">{opt.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Auth-specific fields */}
              {auth.type === "oauth2" && (
                <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent font-medium">MCP Spec</span>
                    OAuth 2.1 Authorization with RFC 9728 Protected Resource Metadata
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-text">Grant Type</label>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1.5 text-sm text-text cursor-pointer">
                        <input
                          type="radio"
                          checked={auth.oauth2GrantType !== "authorization_code"}
                          onChange={() => updateAuth("oauth2GrantType", "client_credentials")}
                          className="accent-accent"
                        />
                        Client Credentials
                      </label>
                      <label className="flex items-center gap-1.5 text-sm text-text cursor-pointer">
                        <input
                          type="radio"
                          checked={auth.oauth2GrantType === "authorization_code"}
                          onChange={() => updateAuth("oauth2GrantType", "authorization_code")}
                          className="accent-accent"
                        />
                        Authorization Code
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InputField
                      label="Authorization URL"
                      value={auth.oauth2AuthUrl || ""}
                      onChange={(v) => updateAuth("oauth2AuthUrl", v)}
                      placeholder="https://auth.example.com/authorize"
                      hint={auth.oauth2GrantType === "client_credentials" ? "Optional for client credentials flow" : "Required for authorization code flow"}
                    />
                    <InputField
                      label="Token URL"
                      value={auth.oauth2TokenUrl || ""}
                      onChange={(v) => updateAuth("oauth2TokenUrl", v)}
                      placeholder="https://auth.example.com/token"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InputField
                      label="Client ID"
                      value={auth.oauth2ClientId || ""}
                      onChange={(v) => updateAuth("oauth2ClientId", v)}
                      placeholder="client-id"
                    />
                    <InputField
                      label="Client Secret"
                      value={auth.oauth2ClientSecret || ""}
                      onChange={(v) => updateAuth("oauth2ClientSecret", v)}
                      placeholder="client-secret"
                      type="password"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InputField
                      label="Scope"
                      value={auth.oauth2Scope || ""}
                      onChange={(v) => updateAuth("oauth2Scope", v)}
                      placeholder="read write tools (space-separated)"
                    />
                    <InputField
                      label="Resource Metadata URL"
                      value={auth.oauth2ResourceMetadataUrl || ""}
                      onChange={(v) => updateAuth("oauth2ResourceMetadataUrl", v)}
                      placeholder="https://mcp.example.com/.well-known/oauth-protected-resource"
                      hint="RFC 9728 — auto-discovered from server if blank"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={auth.oauth2Pkce ?? true}
                        onChange={(e) => updateAuth("oauth2Pkce", e.target.checked)}
                        className="accent-accent rounded"
                      />
                      Enable PKCE (Proof Key for Code Exchange)
                      <span className="text-[11px] text-text-muted">Required by MCP spec for authorization code flow</span>
                    </label>
                  </div>
                </div>
              )}

              {auth.type === "bearer" && (
                <InputField
                  label="Bearer Token"
                  value={auth.token || ""}
                  onChange={(v) => updateAuth("token", v)}
                  placeholder="sk-..."
                  type="password"
                />
              )}

              {auth.type === "api-key" && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-text">Send API Key In</label>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1.5 text-sm text-text cursor-pointer">
                        <input type="radio" checked={auth.apiKeyIn !== "query"} onChange={() => updateAuth("apiKeyIn", "header")} className="accent-accent" />
                        Header
                      </label>
                      <label className="flex items-center gap-1.5 text-sm text-text cursor-pointer">
                        <input type="radio" checked={auth.apiKeyIn === "query"} onChange={() => updateAuth("apiKeyIn", "query")} className="accent-accent" />
                        Query Parameter
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InputField
                      label={auth.apiKeyIn === "query" ? "Parameter Name" : "Header Name"}
                      value={auth.apiKeyHeader || ""}
                      onChange={(v) => updateAuth("apiKeyHeader", v)}
                      placeholder={auth.apiKeyIn === "query" ? "api_key" : "X-API-Key"}
                    />
                    <InputField label="API Key" value={auth.apiKey || ""} onChange={(v) => updateAuth("apiKey", v)} placeholder="your-api-key" type="password" />
                  </div>
                </div>
              )}

              {auth.type === "basic" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <InputField label="Username" value={auth.username || ""} onChange={(v) => updateAuth("username", v)} placeholder="username" />
                  <InputField label="Password" value={auth.password || ""} onChange={(v) => updateAuth("password", v)} placeholder="password" type="password" />
                </div>
              )}

              {auth.type === "mtls" && (
                <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
                  <div className="text-xs text-text-muted">
                    Mutual TLS — paste PEM-encoded certificates. The runtime will use these for the TLS handshake.
                  </div>
                  <InputField
                    label="Client Certificate (PEM)"
                    value={auth.mtlsCert || ""}
                    onChange={(v) => updateAuth("mtlsCert", v)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    mono
                    rows={4}
                  />
                  <InputField
                    label="Client Private Key (PEM)"
                    value={auth.mtlsKey || ""}
                    onChange={(v) => updateAuth("mtlsKey", v)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    mono
                    rows={4}
                    type="password"
                  />
                  <InputField
                    label="CA Certificate (PEM, optional)"
                    value={auth.mtlsCa || ""}
                    onChange={(v) => updateAuth("mtlsCa", v)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    mono
                    rows={3}
                    hint="Custom CA to verify the server certificate"
                  />
                </div>
              )}

              {auth.type === "custom-header" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <InputField label="Header Name" value={auth.customHeaderName || ""} onChange={(v) => updateAuth("customHeaderName", v)} placeholder="X-Custom-Auth" />
                  <InputField label="Header Value" value={auth.customHeaderValue || ""} onChange={(v) => updateAuth("customHeaderValue", v)} placeholder="value" type="password" />
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleRegister}
                  disabled={saving || !name.trim() || !url.trim()}
                  className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {saving ? "Registering..." : "Register Server"}
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-text-muted">Loading...</div>
        ) : servers.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface-card py-16 text-center">
            <div className="mb-2 text-4xl text-text-muted">~</div>
            <p className="text-text-muted">No MCP servers registered</p>
            <button
              onClick={() => setShowRegister(true)}
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Register your first server
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {servers.map((srv) => (
              <div key={srv.id} className="rounded-xl border border-border bg-surface-card p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">{srv.name}</span>
                      {statusBadge(srv.status)}
                    </div>
                    <div className="mt-1 truncate text-sm text-text-muted">{srv.url}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <span>Transport: {srv.transport}</span>
                      {srv.headers?.["X-Auth-Type"] && (
                        <>
                          <span className="text-border">|</span>
                          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase">
                            {srv.headers["X-Auth-Type"]}
                          </span>
                        </>
                      )}
                      {srv.auth_header && !srv.headers?.["X-Auth-Type"] && (
                        <>
                          <span className="text-border">|</span>
                          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase">
                            {srv.auth_header.startsWith("Bearer") ? "bearer" : srv.auth_header.startsWith("Basic") ? "basic" : "auth"}
                          </span>
                        </>
                      )}
                      {srv.tools && srv.tools.length > 0 && (
                        <>
                          <span className="text-border">|</span>
                          <span>{srv.tools.length} tool(s)</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => handlePing(srv.id)}
                      disabled={pinging === srv.id}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs text-text transition-colors hover:bg-surface disabled:opacity-50"
                    >
                      {pinging === srv.id ? "Pinging..." : "Ping"}
                    </button>
                    <button
                      onClick={() => handleDelete(srv.id, srv.name)}
                      className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {srv.tools && srv.tools.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-2 text-xs font-medium text-text-muted uppercase tracking-wider">Discovered Tools</div>
                    <div className="flex flex-wrap gap-2">
                      {srv.tools.map((tool) => (
                        <span
                          key={tool.name}
                          title={tool.description || ""}
                          className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text"
                        >
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
