"use client";
// System · Backups: honest state — nothing connected yet.
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function SystemBackupsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Global administration · not scoped to the selected server"
        title="Backups & recovery"
        explain="Backup status and recovery operations for the fleet."
      />
      <Panel title="Not connected yet" detail="Backup tooling ships with the infrastructure rollout.">
        <Empty
          title="No backup system is connected"
          detail="Schedule, last successful run and recovery actions will appear here once backup tooling is deployed."
        />
      </Panel>
    </>
  );
}
