"use client";
// Settings · Server: the server-wide pause preference.
import { useOverview } from "../../../components/staff/use-overview";
import { useStaff } from "../../../components/staff/staff-context";
import { ServerSettingsPanel } from "../../../components/staff/panels";
import { PageHeader } from "../../../components/staff/ui";

export default function SettingsServerPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Server"
        explain="Preferences that apply to everything the fleet does in the selected server."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <ServerSettingsPanel guildId={guild} canOperate={scopes.includes("*")} scope="server" />
    </>
  );
}
