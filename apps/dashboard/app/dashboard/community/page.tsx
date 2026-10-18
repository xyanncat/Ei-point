"use client";
// Community: welcomes & leave, announcements (composer + delivery), levels and
// the card economy — grouped configuration lives here, not in a global page.
import { useOverview } from "../../../components/staff/use-overview";
import { useStaff } from "../../../components/staff/staff-context";
import { AnnouncementComposer } from "../../../components/staff/composer";
import { ModuleConfig } from "../../../components/staff/panels";
import { PageHeader, Panel } from "../../../components/staff/ui";

const COMMUNITY_MODULES = ["welcome", "leveling", "community", "announcements", "games"];

export default function CommunityPage() {
  const { guild } = useStaff();
  const { data, busy } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const canOperate = scopes.includes("*");
  const assigned = [...new Set((data?.cards ?? []).flatMap((c) => c.modules ?? []))];
  const modules = assigned.filter((m) => COMMUNITY_MODULES.includes(m));

  return (
    <>
      <PageHeader
        eyebrow="Staff workspace"
        title="Community"
        explain="Welcomes, announcements, levels and the card economy for the selected server."
        actions={
          <button className="sf-ghost" onClick={() => window.location.reload()} disabled={busy}>
            Refresh
          </button>
        }
      />
      <ModuleConfig guildId={guild} modules={modules} canOperate={canOperate} />
      <AnnouncementComposer guildId={guild} canOperate={canOperate} />
      <Panel title="Card economy" detail="Catalog management, packs and market arrive with the Silver Wolf game modules.">
        <p className="sf-dim">
          Instances, listings and trades are created only inside database transactions — this page will expose
          catalog definitions here once the economy module publishes them.
        </p>
      </Panel>
    </>
  );
}
