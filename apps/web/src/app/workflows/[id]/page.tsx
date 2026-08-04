"use client";

import WorkflowEditor from "@/components/WorkflowEditor";

export default function WorkflowDetailPage({ params }: { params: { id: string } }) {
  return <WorkflowEditor workflowId={params.id} />;
}
