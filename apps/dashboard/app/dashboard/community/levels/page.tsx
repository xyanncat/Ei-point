"use client";
// Community · Levels: configuration for the leveling module.
import { useOverview } from "../../../../components/staff/use-overview";
import { useStaff } from "../../../../components/staff/staff-context";
import { ModuleConfig } from "../../../../components/staff/panels";
import { PageHeader } from "../../../../components/staff/ui";

export default function CommunityLevelsPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const assigned = [...new Set((data?.cards ?? []).flatMap((c) => c.modules ?? []))];
  const modules = assigned.filter((m) => ["leveling"].includes(m));

  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Levels"
        explain="Experience rates and level announcements for the selected server."
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
