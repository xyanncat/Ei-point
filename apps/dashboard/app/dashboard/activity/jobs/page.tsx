"use client";
// Activity · Job history: background deliveries across the workspace.
import { useStaff } from "../../../../components/staff/staff-context";
import { JobsPanel } from "../../../../components/staff/panels";
import { PageHeader } from "../../../../components/staff/ui";

export default function ActivityJobsPage() {
  const { guild } = useStaff();

  return (
    <>
      <PageHeader
        eyebrow="Activity"
        title="Job history"
        explain="Background deliveries and their outcomes for the selected server."
      />
      <JobsPanel guildId={guild} title="Queue deliveries" />
    </>
  );
}
