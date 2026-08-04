"use client";

import { useState, useEffect } from "react";
import { WorkflowSpec } from "@/lib/types";

interface SpecEditorProps {
  spec: WorkflowSpec;
  onSpecChange: (spec: WorkflowSpec) => void;
}

export default function SpecEditor({ spec, onSpecChange }: SpecEditorProps) {
  const [text, setText] = useState(JSON.stringify(spec, null, 2));
  const [error, setError] = useState("");

  useEffect(() => {
    setText(JSON.stringify(spec, null, 2));
  }, [spec]);

  function handleChange(value: string) {
    setText(value);
    try {
      const parsed = JSON.parse(value);
      if (parsed.nodes && parsed.edges) {
        setError("");
        onSpecChange(parsed);
      } else {
        setError("Spec must have 'nodes' and 'edges' arrays");
      }
    } catch {
      setError("Invalid JSON");
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface-card">
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
