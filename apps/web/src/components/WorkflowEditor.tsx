"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
} from "@xyflow/react";
import { isAuthenticated } from "@/lib/auth";
import { compileSpec, createWorkflow, updateWorkflow, deleteWorkflow, deployWorkflow, startRun, getRunTrace, getWorkflow, downloadWorkflowCode } from "@/lib/api";
import { WorkflowSpec, RunEvent, TraceSpan, NodeErrorMap, ConfigFieldSchema } from "@/lib/types";
import TopBar from "@/components/TopBar";
import NodePalette from "@/components/NodePalette";
import Canvas from "@/components/Canvas";
import ConfigPanel from "@/components/ConfigPanel";
import RunPanel from "@/components/RunPanel";
import SpecEditor from "@/components/SpecEditor";

let nodeIdCounter = 0;

function generateNodeId(type: string): string {
  nodeIdCounter += 1;
  return `${type}_${nodeIdCounter}`;
}

function flowNodesToSpec(nodes: Node[], edges: Edge[]): WorkflowSpec {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as { nodeType: string }).nodeType,
      config: (n.data as { config: Record<string, unknown> }).config || {},
    })),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    })),
  };
}

function specToFlowNodes(spec: WorkflowSpec): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = spec.nodes.map((n, i) => ({
    id: n.id,
    type: "custom",
    position: { x: 250, y: i * 120 + 50 },
    data: { nodeType: n.type, config: n.config, label: n.type },
    selected: false,
  }));
  const edges: Edge[] = spec.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    animated: true,
    style: { stroke: "var(--color-accent)", strokeWidth: 2 },
  }));
  return { nodes, edges };
}

interface WorkflowEditorProps {
  workflowId?: string;
}

export default function WorkflowEditor({ workflowId: initialId }: WorkflowEditorProps) {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState("Untitled Workflow");
  const [workflowId, setWorkflowId] = useState<string | null>(initialId ?? null);
  const [showSpec, setShowSpec] = useState(false);
  const [compileStatus, setCompileStatus] = useState<{
    ok: boolean;
    errors: string[];
    unreachable?: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [traceSpans, setTraceSpans] = useState<TraceSpan[]>([]);
  const [running, setRunning] = useState(false);
  const cancelRunRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAuthenticated()) {
      window.location.href = "/login";
      return;
    }
  }, []);

  useEffect(() => {
    if (!initialId) return;

    async function loadWorkflow(wfId: string) {
      try {
        const wf = await getWorkflow(wfId);
        const spec = wf.spec as WorkflowSpec;
        const { nodes: newNodes, edges: newEdges } = specToFlowNodes(spec);
        setNodes(newNodes);
        setEdges(newEdges);
        setWorkflowName(wf.name);
        setWorkflowId(wf.id);
      } catch {
        router.push("/workflows");
      }
    }

    loadWorkflow(initialId);
  }, [initialId, setNodes, setEdges, router]);

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handleDrop = useCallback(
    (type: string, config: Record<string, unknown>, position: { x: number; y: number }, configSchema?: Record<string, ConfigFieldSchema>) => {
      const id = generateNodeId(type);
      const newNode: Node = {
        id,
        type: "custom",
        position,
        data: { nodeType: type, config: { ...config }, configSchema, label: type },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  const handleNodeSelect = useCallback(
    (node: Node | null) => {
      setSelectedNode(node);
      if (node) {
        setNodes((nds) =>
          nds.map((n) => ({ ...n, selected: n.id === node.id }))
        );
      }
    },
    [setNodes]
  );

  const handleConfigChange = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, config } }
            : n
        )
      );
      setSelectedNode((prev) =>
        prev && prev.id === nodeId
          ? { ...prev, data: { ...prev.data, config } }
          : prev
      );
    },
    [setNodes]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
      );
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  const handleCompile = useCallback(async () => {
    const spec = flowNodesToSpec(nodes, edges);
    try {
      const result = await compileSpec(spec);
      setCompileStatus({ ok: result.ok, errors: result.errors || [], unreachable: result.unreachable });
    } catch (err) {
      setCompileStatus({
        ok: false,
        errors: [err instanceof Error ? err.message : "Compile failed"],
      });
    }
  }, [nodes, edges]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const spec = flowNodesToSpec(nodes, edges);
    try {
      if (workflowId) {
        await updateWorkflow(workflowId, { name: workflowName, spec });
      } else {
        const result = await createWorkflow(workflowName, spec);
        setWorkflowId(result.id);
        router.replace(`/workflows/${result.id}`);
      }
    } catch {
      /* ignored */
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, workflowName, workflowId, router]);

  const handleDelete = useCallback(async () => {
    if (!workflowId) return;
    if (!confirm(`Delete workflow "${workflowName}"?`)) return;
    try {
      await deleteWorkflow(workflowId);
      router.push("/workflows");
    } catch {
      alert("Failed to delete workflow");
    }
  }, [workflowId, workflowName, router]);

  const handleDownloadCode = useCallback(async () => {
    if (!workflowId) {
      alert("Save the workflow first");
      return;
    }
    try {
      await downloadWorkflowCode(workflowId);
    } catch {
      alert("Failed to download code");
    }
  }, [workflowId]);

  const handleDeploy = useCallback(async () => {
    if (!workflowId) {
      alert("Save the workflow first");
      return;
    }
    try {
      await deployWorkflow(workflowId);
      alert("Deployed");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Deploy failed");
    }
  }, [workflowId]);

  const handleRun = useCallback(async () => {
    if (!workflowId) {
      alert("Save the workflow first");
      return;
    }
    setRunning(true);
    setRunEvents([]);
    setTraceSpans([]);
    const cancel = startRun(
      workflowId,
      (evt) => {
        setRunEvents((prev) => [
          ...prev,
          { event: evt.event, data: evt.data as unknown as Record<string, unknown> },
        ]);
      },
      async () => {
        setRunning(false);
        try {
          const trace = await getRunTrace(workflowId);
          setTraceSpans(trace);
        } catch {
          /* ignored */
        }
      }
    );
    cancelRunRef.current = cancel;
  }, [workflowId]);

  const handleSpecChange = useCallback(
    (spec: WorkflowSpec) => {
      const { nodes: newNodes, edges: newEdges } = specToFlowNodes(spec);
      setNodes(newNodes);
      setEdges(newEdges);
    },
    [setNodes, setEdges]
  );

  const nodeErrorMap: NodeErrorMap = useMemo(() => {
    const map: NodeErrorMap = new Map();
    if (!compileStatus) return map;

    const nodeIdPattern = /on node '([^']+)'/;
    const edgeSourcePattern = /edge source '([^']+)'/;

    for (const err of compileStatus.errors) {
      let nodeId: string | null = null;
      const nodeMatch = err.match(nodeIdPattern);
      if (nodeMatch) {
        nodeId = nodeMatch[1];
      } else {
        const edgeMatch = err.match(edgeSourcePattern);
        if (edgeMatch) {
          nodeId = edgeMatch[1];
        }
      }
      if (nodeId) {
        const entry = map.get(nodeId) || { errors: [], unreachable: false };
        entry.errors.push(err);
        map.set(nodeId, entry);
      }
    }

    if (compileStatus.unreachable) {
      for (const nodeId of compileStatus.unreachable) {
        const entry = map.get(nodeId) || { errors: [], unreachable: false };
        entry.unreachable = true;
        map.set(nodeId, entry);
      }
    }

    return map;
  }, [compileStatus]);

  const currentSpec = flowNodesToSpec(nodes, edges);

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        workflowName={workflowName}
        onNameChange={setWorkflowName}
        onCompile={handleCompile}
        onSave={handleSave}
        onDeploy={handleDeploy}
        onRun={handleRun}
        onToggleSpec={() => setShowSpec(!showSpec)}
        onDownloadCode={handleDownloadCode}
        onDelete={handleDelete}
        showSpec={showSpec}
        compileStatus={compileStatus}
        saving={saving}
        workflowId={workflowId}
      />
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />
        {showSpec ? (
          <div className="flex-1">
            <SpecEditor spec={currentSpec} onSpecChange={handleSpecChange} />
          </div>
        ) : (
          <Canvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeSelect={handleNodeSelect}
            onDrop={handleDrop}
            nodeErrorMap={nodeErrorMap}
          />
        )}
        <ConfigPanel
          node={selectedNode}
          onConfigChange={handleConfigChange}
          onDelete={handleDeleteNode}
        />
      </div>
      <RunPanel events={runEvents} trace={traceSpans} running={running} />
    </div>
  );
}
