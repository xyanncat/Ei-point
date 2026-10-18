"use client";
// Commerce · Orders: the full order table with quick inspection. Review
// actions live under Payment review.
import { useOverview } from "../../../components/staff/use-overview";
import { useStaff } from "../../../components/staff/staff-context";
import { CommerceOrders } from "../../../components/staff/orders";
import { PageHeader } from "../../../components/staff/ui";

export default function CommerceOrdersPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();

  return (
    <>
      <PageHeader
        eyebrow="Commerce"
        title="Orders"
        explain="Every purchase recorded for this server, newest first."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <CommerceOrders guildId={guild} scopes={data?.guild.scopes ?? []} title="Order history" />
    </>
  );
}
