"use client";
// Settings · Notifications: who gets told about what.
import { useOverview } from "../../../../components/staff/use-overview";
import { useStaff } from "../../../../components/staff/staff-context";
import { ServerSettingsPanel } from "../../../../components/staff/panels";
import { PageHeader } from "../../../../components/staff/ui";

export default function SettingsNotificationsPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Notifications"
        explain="Which staff channels and categories receive alerts from the fleet."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <ServerSettingsPanel guildId={guild} canOperate={scopes.includes("*")} scope="notifications" />
    </>
  );
}
