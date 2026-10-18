"use client";
// Community · Announcements: embed composer (editor + preview) and delivery.
import { useOverview } from "../../../../components/staff/use-overview";
import { useStaff } from "../../../../components/staff/staff-context";
import { AnnouncementComposer } from "../../../../components/staff/composer";
import { PageHeader } from "../../../../components/staff/ui";

export default function CommunityAnnouncementsPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Announcements"
        explain="Compose an embed, check the draft, then queue it for the sending bot."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <AnnouncementComposer guildId={guild} canOperate={scopes.includes("*")} />
    </>
  );
}
