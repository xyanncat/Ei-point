"use client";
// System · Integrations: infrastructure provider accounts (global).
import { useStaff } from "../../../../components/staff/staff-context";
import { AccountsPanel } from "../../../../components/staff/system";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function SystemIntegrationsPage() {
  const { isAdmin } = useStaff();
  return (
    <>
      <PageHeader
        eyebrow="Global administration · not scoped to the selected server"
        title="Integrations & accounts"
        explain="Provider metadata for the services the fleet runs on. Credentials live in the vault."
      />
      {isAdmin ? (
        <AccountsPanel />
      ) : (
        <Panel title="Owner/admin only">
          <Empty title="No access" detail="An admin scope is required for infrastructure accounts." />
        </Panel>
      )}
    </>
  );
}
