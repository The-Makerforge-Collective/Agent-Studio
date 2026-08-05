"use client";

import { useState, useEffect } from "react";
import * as yaml from "js-yaml";
import { WorkflowSpec } from "@/lib/types";

type Format = "json" | "yaml";

interface SpecEditorProps {
  spec: WorkflowSpec;
  onSpecChange: (spec: WorkflowSpec) => void;
}

function serialize(spec: WorkflowSpec, format: Format): string {
  if (format === "yaml") return yaml.dump(spec, { lineWidth: -1 });
  return JSON.stringify(spec, null, 2);
}

function parse(text: string, format: Format): WorkflowSpec | null {
  try {
    const parsed = format === "yaml" ? yaml.load(text) : JSON.parse(text);
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return parsed as WorkflowSpec;
    }
  } catch {
    // invalid syntax
  }
  return null;
}

export default function SpecEditor({ spec, onSpecChange }: SpecEditorProps) {
  const [format, setFormat] = useState<Format>("json");
  const [text, setText] = useState(serialize(spec, "json"));
  const [error, setError] = useState("");

  useEffect(() => {
    setText(serialize(spec, format));
  }, [spec, format]);

  function handleChange(value: string) {
    setText(value);
    const parsed = parse(value, format);
    if (parsed) {
      setError("");
      onSpecChange(parsed);
    } else {
      setError(format === "yaml" ? "Invalid YAML or missing nodes/edges" : "Invalid JSON or missing nodes/edges");
    }
  }

  function handleFormatToggle(newFormat: Format) {
    const parsed = parse(text, format);
    if (parsed) {
      setFormat(newFormat);
      setText(serialize(parsed, newFormat));
      setError("");
    } else {
      setFormat(newFormat);
      setError(`Fix current ${format.toUpperCase()} errors before switching`);
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface-card">
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        {(["json", "yaml"] as const).map((f) => (
          <button
            key={f}
            onClick={() => handleFormatToggle(f)}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              format === f
                ? "bg-accent text-white"
                : "text-text-muted hover:text-text"
            }`}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      {error && (
        <div className="border-b border-red-300 bg-red-50 px-3 py-1 text-xs text-red-600">
          {error}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className="h-full w-full flex-1 resize-none bg-surface p-4 font-mono text-xs outline-none"
        spellCheck={false}
      />
    </div>
  );
}
