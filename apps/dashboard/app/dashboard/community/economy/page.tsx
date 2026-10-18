"use client";
// Community · Cards & economy: game module configuration plus the honest
// state of catalog and market management.
import { useOverview } from "../../../../components/staff/use-overview";
import { useStaff } from "../../../../components/staff/staff-context";
import { ModuleConfig } from "../../../../components/staff/panels";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function CommunityEconomyPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const assigned = [...new Set((data?.cards ?? []).flatMap((c) => c.modules ?? []))];
  const modules = assigned.filter((m) => ["games"].includes(m));

  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Cards & economy"
        explain="Card drops, packs and the market for the selected server."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <ModuleConfig guildId={guild} modules={modules} canOperate={scopes.includes("*")} />
      <Panel title="Catalog & market" detail="Managed by the game modules; nothing here is a placeholder list.">
        <Empty
          title="Not connected yet"
          detail="Catalog definitions, listings and trades appear here once the economy module publishes them. Instances are created inside database transactions only."
        />
      </Panel>
    </>
  );
}
