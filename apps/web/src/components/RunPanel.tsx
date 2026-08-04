"use client";

import { TraceSpan, RunEvent } from "@/lib/types";

interface RunPanelProps {
  events: RunEvent[];
  trace: TraceSpan[];
  running: boolean;
}

export default function RunPanel({ events, trace, running }: RunPanelProps) {
  if (events.length === 0 && trace.length === 0) {
    return null;
  }

  return (
    <div className="h-48 overflow-y-auto border-t border-border bg-surface-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
          Run Output
        </h3>
        {running && (
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
        )}
      </div>
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
              <tr key={i} className="border-t border-border">
                <td className="py-1 pr-4 font-mono">{span.node}</td>
                <td className="py-1 pr-4">{span.type}</td>
                <td className="py-1 pr-4">
                  <span
                    className={
                      span.status === "ok"
                        ? "text-green-600"
                        : span.status === "error"
                        ? "text-red-500"
                        : "text-text-muted"
                    }
                  >
                    {span.status}
                  </span>
                </td>
                <td className="py-1">{span.duration_ms}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {events.length > 0 && (
        <div className="space-y-0.5 font-mono text-xs">
          {events.map((evt, i) => (
            <div key={i} className="text-text-muted">
              <span className="text-accent">[{evt.event}]</span>{" "}
              {typeof evt.data === "object"
                ? JSON.stringify(evt.data)
                : String(evt.data)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
