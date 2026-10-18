"use client";
// System · Guilds: fleet-wide server approvals. Global administration, not
// scoped to whichever server happens to be selected.
import { useStaff } from "../../../components/staff/staff-context";
import { GuildsPanel } from "../../../components/staff/system";
import { Empty, PageHeader, Panel } from "../../../components/staff/ui";

export default function SystemGuildsPage() {
  const { isAdmin } = useStaff();
  return (
    <>
      <PageHeader
        eyebrow="Global administration · not scoped to the selected server"
        title="Approved servers"
        explain="Which Discord servers may use the fleet. Changes affect every server."
      />
      {isAdmin ? (
        <GuildsPanel />
      ) : (
        <Panel title="Owner/admin only">
          <Empty title="No access" detail="An admin scope is required for fleet-wide controls." />
        </Panel>
      )}
    </>
  );
}
