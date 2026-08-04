"use client";

import { useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NodeErrorMap } from "@/lib/types";
import CustomNode from "./CustomNode";

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onNodeSelect: (node: Node | null) => void;
  onDrop: (type: string, config: Record<string, unknown>, position: { x: number; y: number }) => void;
  nodeErrorMap?: NodeErrorMap;
}

export default function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeSelect,
  onDrop,
  nodeErrorMap,
}: CanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/agent-studio-node");
      if (!raw) return;
      const { type, config } = JSON.parse(raw);
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const position = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      onDrop(type, config, position);
    },
    [onDrop]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeSelect(node);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  // Enrich nodes with compile diagnostics so CustomNode can render them
  const enrichedNodes = useMemo(() => {
    if (!nodeErrorMap || nodeErrorMap.size === 0) return nodes;
    return nodes.map((n) => {
      const diag = nodeErrorMap.get(n.id);
      if (!diag) return n;
      return { ...n, data: { ...n.data, _compileErrors: diag.errors, _unreachable: diag.unreachable } };
    });
  }, [nodes, nodeErrorMap]);

  return (
    <div ref={wrapperRef} className="h-full flex-1">
      <ReactFlow
        nodes={enrichedNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        nodeTypes={nodeTypes}
        fitView
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: "var(--color-accent)", strokeWidth: 2 },
        }}
      >
        <Background color="var(--color-border)" gap={20} />
        <Controls className="!border-border !bg-surface-card !shadow-sm" />
        <MiniMap
          className="!border-border !bg-surface-card"
          nodeColor="var(--color-accent)"
          maskColor="rgba(0,0,0,0.1)"
        />
      </ReactFlow>
    </div>
  );
}
