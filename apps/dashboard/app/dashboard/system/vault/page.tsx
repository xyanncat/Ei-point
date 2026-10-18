"use client";
// System · Secret vault: masked values, explicit reveal, replace and delete.
import { useStaff } from "../../../../components/staff/staff-context";
import { VaultPanel } from "../../../../components/staff/system";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function SystemVaultPage() {
  const { isAdmin } = useStaff();
  return (
    <>
      <PageHeader
        eyebrow="Global administration · not scoped to the selected server"
        title="Secret vault"
        explain="Credentials for integrations and bots. Values stay masked until explicitly revealed."
      />
      {isAdmin ? (
        <VaultPanel />
      ) : (
        <Panel title="Owner/admin only">
          <Empty title="No access" detail="An admin scope is required for the vault." />
        </Panel>
      )}
    </>
  );
}
