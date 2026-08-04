"use client";

import { TraceSpan, RunEvent } from "@/lib/types";

interface RunPanelProps {
  events: RunEvent[];
  trace: TraceSpan[];
  running: boolean;
  onClear?: () => void;
}

export default function RunPanel({
  events,
  trace,
  running,
  onClear,
}: RunPanelProps) {
  const isEmpty = events.length === 0 && trace.length === 0;

  return (
    <div className="h-48 overflow-y-auto border-t border-border bg-surface-card">
      {/* Header bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-card px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Run Output
          </h3>
          {running && (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
          )}
        </div>
        {!isEmpty && onClear && (
          <button
            onClick={onClear}
            className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-surface hover:text-text transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Empty state */}
      {isEmpty && !running ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-text-muted">
            No runs yet. Click &#9654; Run to execute your workflow.
          </p>
        </div>
      ) : (
        <div className="p-3">
          {/* Trace spans */}
          {trace.length > 0 && (
            <table className="mb-2 w-full text-xs">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="pb-1 pr-4">Node</th>
                  <th className="pb-1 pr-4">Type</th>
                  <th className="pb-1 pr-4">Status</th>
                  <th className="pb-1">Duration</th>
                </tr>
              </thead>
              <tbody>
                {trace.map((span, i) => (
                  <tr
                    key={i}
                    className={`border-t border-border ${
                      i % 2 === 0 ? "bg-surface/50" : ""
                    }`}
                  >
                    <td className="py-1.5 pr-4 font-mono">{span.node}</td>
                    <td className="py-1.5 pr-4">{span.type}</td>
                    <td className="py-1.5 pr-4">
                      <span
                        className={`inline-flex items-center gap-1 ${
                          span.status === "ok"
                            ? "text-green-600"
                            : span.status === "error"
                            ? "text-red-500"
                            : "text-text-muted"
                        }`}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            span.status === "ok"
                              ? "bg-green-500"
                              : span.status === "error"
                              ? "bg-red-500"
                              : "bg-text-muted"
                          }`}
                        />
                        {span.status}
                      </span>
                    </td>
                    <td className="py-1.5 font-mono">{span.duration_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Events */}
          {events.length > 0 && (
            <div className="space-y-0.5 font-mono text-xs">
              {events.map((evt, i) => (
                <div
                  key={i}
                  className={`rounded px-2 py-1 text-text-muted ${
                    i % 2 === 0 ? "bg-surface/50" : ""
                  }`}
                >
                  <span className="text-accent">[{evt.event}]</span>{" "}
                  {typeof evt.data === "object"
                    ? JSON.stringify(evt.data)
                    : String(evt.data)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
