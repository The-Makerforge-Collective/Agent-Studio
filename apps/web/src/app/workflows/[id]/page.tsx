"use client";

import AppShell from "@/components/AppShell";
import WorkflowEditor from "@/components/WorkflowEditor";

export default function WorkflowDetailPage({ params }: { params: { id: string } }) {
  return (
    <AppShell>
      <WorkflowEditor workflowId={params.id} />
    </AppShell>
  );
}
