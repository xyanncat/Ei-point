"use client";
// Community · Welcome & leave: configuration for the welcome module only.
import { useOverview } from "../../../components/staff/use-overview";
import { useStaff } from "../../../components/staff/staff-context";
import { ModuleConfig } from "../../../components/staff/panels";
import { PageHeader } from "../../../components/staff/ui";

export default function CommunityWelcomePage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const assigned = [...new Set((data?.cards ?? []).flatMap((c) => c.modules ?? []))];
  const modules = assigned.filter((m) => ["welcome"].includes(m));

  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Welcome & leave"
        explain="Welcome messages and leave notices for the selected server."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <ModuleConfig guildId={guild} modules={modules} canOperate={scopes.includes("*")} />
    </>
  );
}
