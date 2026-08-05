"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getWorkflow, startRunWithSeed } from "@/lib/api";
import AppShell from "@/components/AppShell";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  nodeId?: string;
}

interface SeedField {
  key: string;
  defaultValue: unknown;
}

function extractOutput(result: Record<string, unknown>): string | null {
  const skip = new Set(["seeded", "credentialed", "approved", "by", "matched", "action"]);
  for (const [key, val] of Object.entries(result)) {
    if (skip.has(key)) continue;
    if (typeof val === "string" && val.trim()) return val;
  }
  if (result.output && typeof result.output === "object") {
    const out = result.output as Record<string, unknown>;
    const seedKeys = new Set(["user_message", "messages"]);
    const meaningful = Object.entries(out).filter(([k]) => !seedKeys.has(k));
    if (meaningful.length > 0) {
      return meaningful
        .map(([k, v]) => (typeof v === "string" ? `**${k}**: ${v}` : `**${k}**: ${JSON.stringify(v)}`))
        .join("\n");
    }
  }
  return null;
}

function discoverSeedFields(spec: { nodes: Record<string, unknown>[] }): SeedField[] {
  const trigger = spec.nodes.find(
    (n: Record<string, unknown>) => n.type === "trigger_api" || n.type === "trigger"
  );
  if (!trigger) return [];
  const config = trigger.config as Record<string, unknown> | undefined;
  const seed = config?.seed as Record<string, unknown> | undefined;
  if (!seed || typeof seed !== "object") return [];
  return Object.entries(seed).map(([key, defaultValue]) => ({ key, defaultValue }));
}

function isChatMode(fields: SeedField[]): boolean {
  if (fields.length === 0) return true;
  return fields.some((f) => f.key === "user_message" || f.key === "messages");
}

export default function ChatAppPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [workflowName, setWorkflowName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [seedFields, setSeedFields] = useState<SeedField[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const cancelRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatMode = isChatMode(seedFields);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
    getWorkflow(params.id)
      .then((wf) => {
        setWorkflowName(wf.name);
        const fields = wf.spec ? discoverSeedFields(wf.spec as { nodes: Record<string, unknown>[] }) : [];
        setSeedFields(fields);
        if (!isChatMode(fields)) {
          const defaults: Record<string, string> = {};
          for (const f of fields) {
            defaults[f.key] = f.defaultValue != null ? String(f.defaultValue) : "";
          }
          setFormValues(defaults);
        }
        setMessages([
          {
            role: "system",
            content: isChatMode(fields)
              ? `Connected to workflow "${wf.name}". Send a message to start.`
              : `Connected to workflow "${wf.name}". Fill in the inputs and run.`,
            timestamp: Date.now(),
          },
        ]);
      })
      .catch(() => router.push("/agents"))
      .finally(() => setLoading(false));
  }, [params.id, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function buildSeed(text?: string): Record<string, unknown> {
    if (chatMode) {
      const t = text ?? input.trim();
      return {
        user_message: t,
        messages: [...messages.filter((m) => m.role !== "system"), { role: "user", content: t }].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };
    }
    const seed: Record<string, unknown> = {};
    for (const f of seedFields) {
      const raw = formValues[f.key] ?? "";
      if (typeof f.defaultValue === "number") {
        seed[f.key] = Number(raw) || 0;
      } else {
        seed[f.key] = raw;
      }
    }
    return seed;
  }

  function handleSend() {
    const text = chatMode ? input.trim() : null;
    if (chatMode && (!text || running)) return;
    if (!chatMode && running) return;
    setInput("");

    const displayContent = chatMode
      ? text!
      : seedFields.map((f) => `**${f.key}**: ${formValues[f.key] ?? ""}`).join("\n");

    const userMsg: ChatMessage = {
      role: "user",
      content: displayContent,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setRunning(true);

    const seed = buildSeed(text ?? undefined);
    const cancel = startRunWithSeed(
      params.id,
      seed,
      (event) => {
        try {
          const data = event.data ? JSON.parse(event.data) : {};

          if (event.event === "messages" && data.result) {
            const result = data.result;
            // Extract meaningful string output from any node type
            const output = extractOutput(result);
            if (output) {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && last.nodeId === data.node) {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: output },
                  ];
                }
                return [
                  ...prev,
                  {
                    role: "assistant",
                    content: output,
                    timestamp: Date.now(),
                    nodeId: data.node,
                  },
                ];
              });
            }
          }

          if (event.event === "done" && data.state) {
            // Show final workflow state as the definitive output
            const state = data.state;
            // Filter out seed/internal keys to show meaningful output
            const seedKeys = new Set(["user_message", "messages", ...seedFields.map((f) => f.key)]);
            const outputEntries = Object.entries(state).filter(
              ([k]) => !seedKeys.has(k)
            );
            if (outputEntries.length > 0) {
              const formatted = outputEntries
                .map(([k, v]) =>
                  typeof v === "string" ? `**${k}**: ${v}` : `**${k}**: ${JSON.stringify(v, null, 2)}`
                )
                .join("\n\n");
              setMessages((prev) => {
                // Replace any intermediate assistant messages with the final output
                const withoutRunning = prev.filter(
                  (m) => !(m.role === "system" && m.content.startsWith("Running:"))
                );
                const lastAssistant = withoutRunning.findIndex(
                  (m) => m.role === "assistant"
                );
                if (lastAssistant >= 0) {
                  // Update last assistant message with complete output
                  return [
                    ...withoutRunning.slice(0, lastAssistant),
                    { ...withoutRunning[lastAssistant], content: formatted },
                    ...withoutRunning.slice(lastAssistant + 1),
                  ];
                }
                return [
                  ...withoutRunning,
                  {
                    role: "assistant" as const,
                    content: formatted,
                    timestamp: Date.now(),
                  },
                ];
              });
            }
          }

          if (event.event === "error") {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Error: ${data.errors?.join(", ") || "Unknown error"}`,
                timestamp: Date.now(),
              },
            ]);
          }

          if (event.event === "node_start" && data.type) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "system" && last.content.startsWith("Running:")) {
                return [
                  ...prev.slice(0, -1),
                  {
                    role: "system",
                    content: `Running: ${data.node} (${data.type})`,
                    timestamp: Date.now(),
                  },
                ];
              }
              return [
                ...prev,
                {
                  role: "system",
                  content: `Running: ${data.node} (${data.type})`,
                  timestamp: Date.now(),
                },
              ];
            });
          }
        } catch {
          // ignore parse errors
        }
      },
      () => {
        setRunning(false);
        // Clean up any trailing "Running:" status messages
        setMessages((prev) =>
          prev.filter((m) => !(m.role === "system" && m.content.startsWith("Running:")))
        );
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    );
    cancelRef.current = cancel;
  }

  function handleCancel() {
    cancelRef.current?.();
    setRunning(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface-card px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/agents")}
              className="text-text-muted hover:text-text transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div>
              <h2 className="text-sm font-semibold text-text">{workflowName}</h2>
              <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${running ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
                {running ? "Processing..." : "Ready"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push(`/workflows/${params.id}`)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface transition-colors"
            >
              View Workflow
            </button>
            <button
              onClick={() => {
                setMessages([
                  {
                    role: "system",
                    content: chatMode
                      ? `Connected to workflow "${workflowName}". Send a message to start.`
                      : `Connected to workflow "${workflowName}". Fill in the inputs and run.`,
                    timestamp: Date.now(),
                  },
                ]);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}
            {running && messages[messages.length - 1]?.role !== "system" && (
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <BotIcon />
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-surface-card px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "0ms" }} />
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "150ms" }} />
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-border bg-surface-card px-6 py-4">
          <div className="mx-auto max-w-2xl">
            {chatMode ? (
              <div className="flex items-end gap-3">
                <div className="relative flex-1">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder="Send a message..."
                    disabled={running}
                    className="w-full resize-none rounded-xl border border-border bg-surface px-4 py-3 pr-12 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
                    style={{ maxHeight: "120px" }}
                  />
                </div>
                {running ? (
                  <button
                    onClick={handleCancel}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-300 text-red-500 transition-colors hover:bg-red-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor"/>
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-all hover:bg-accent-hover disabled:opacity-30"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8h10M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {seedFields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-xs font-medium text-text-muted">{f.key}</span>
                      <input
                        type={typeof f.defaultValue === "number" ? "number" : "text"}
                        value={formValues[f.key] ?? ""}
                        onChange={(e) => setFormValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        disabled={running}
                        placeholder={f.defaultValue != null ? String(f.defaultValue) : ""}
                        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:border-accent focus:outline-none disabled:opacity-50"
                      />
                    </label>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  {running ? (
                    <button
                      onClick={handleCancel}
                      className="rounded-lg border border-red-300 px-4 py-2 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-all hover:bg-accent-hover"
                    >
                      Run Workflow
                    </button>
                  )}
                </div>
              </div>
            )}
            {chatMode && (
              <div className="mt-2 text-center text-[10px] text-text-muted">
                Enter to send &middot; Shift+Enter for new line
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-surface px-3 py-1 text-[11px] text-text-muted">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-accent px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <BotIcon />
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-surface-card px-4 py-2.5 text-sm text-text whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  );
}

function BotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="6" cy="7" r="1" fill="currentColor"/>
      <circle cx="10" cy="7" r="1" fill="currentColor"/>
      <path d="M6 10.5c.5.5 1 .8 2 .8s1.5-.3 2-.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}
