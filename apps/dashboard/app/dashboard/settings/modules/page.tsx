"use client";
// Settings · Modules: configuration for modules whose home is not one of the
// sections (welcome/levels/economy live under Community, protection under
// Moderation — one home per module).
import { useOverview } from "../../../../components/staff/use-overview";
import { useStaff } from "../../../../components/staff/staff-context";
import { ModuleConfig } from "../../../../components/staff/panels";
import { PageHeader, Panel } from "../../../../components/staff/ui";

const SECTION_OWNED = ["welcome", "leveling", "games", "security", "moderation", "logging", "announcements"];

export default function SettingsModulesPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const assigned = [...new Set((data?.cards ?? []).flatMap((c) => c.modules ?? []))];
  const modules = assigned.filter((m) => !SECTION_OWNED.includes(m));

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Modules"
        explain="Runtime configuration for the modules that are not owned by a section."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <ModuleConfig guildId={guild} modules={modules} canOperate={scopes.includes("*")} />
      <Panel title="Where other modules live" detail="One home per module — nothing is configured twice.">
        <ul className="sf-list">
          <li><span className="sf-dot" />Welcomes & leave, levels, cards & economy<span className="sf-dim">Community</span></li>
          <li><span className="sf-dot" />Security, moderation, audit logging<span className="sf-dim">Moderation · Protection rules</span></li>
        </ul>
      </Panel>
    </>
  );
}
