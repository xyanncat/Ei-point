"use client";
// System: owner/admin-only operational controls, separated from the selected
// Discord server (owner brief). Relocated from "Administration".
import { useStaff } from "../../../components/staff/staff-context";
import { SystemPanels } from "../../../components/staff/system";
import { Empty, PageHeader, Panel } from "../../../components/staff/ui";

export default function SystemPage() {
  const { guild, isAdmin } = useStaff();
  return (
    <>
      <PageHeader
        eyebrow="System · owner/admin only"
        title="Infrastructure & access"
        explain="Global controls — approvals, staff scopes, the secret vault and provider accounts. These affect the whole fleet, not one server."
      />
      {isAdmin ? (
        <SystemPanels guildId={guild} />
      ) : (
        <Panel title="Owner/admin only">
          <Empty title="No access" detail="An admin scope is required for authorization and vault controls." />
        </Panel>
      )}
    </>
  );
}
