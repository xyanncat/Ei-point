"use client";
// System · Backups: honest state — nothing connected yet. Admin-gated:
// navigation hiding is not authorization, but the page must not pretend to
// offer privileged controls to non-admins either.
import { useStaff } from "../../../../components/staff/staff-context";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function SystemBackupsPage() {
  const { isAdmin } = useStaff();
  return (
    <>
      <PageHeader
        eyebrow="Global administration · not scoped to the selected server"
        title="Backups & recovery"
        explain="Backup status and recovery operations for the fleet."
      />
      {isAdmin ? (
        <Panel title="Not connected yet" detail="Backup tooling ships with the infrastructure rollout.">
          <Empty
            title="No backup system is connected"
            detail="Schedule, last successful run and recovery actions will appear here once backup tooling is deployed."
          />
        </Panel>
      ) : (
        <Panel title="Owner/admin only">
          <Empty title="No access" detail="An admin scope is required for backup controls." />
        </Panel>
      )}
    </>
  );
}
