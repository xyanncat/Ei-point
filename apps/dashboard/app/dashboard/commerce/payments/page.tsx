"use client";
// Commerce · Payment review: the settlement queue. Reachable directly at
// /dashboard/commerce/payments (acceptance: payment review through Commerce).
import { useOverview } from "../../../../components/staff/use-overview";
import { useStaff } from "../../../../components/staff/staff-context";
import { CommerceOrders } from "../../../../components/staff/orders";
import { PageHeader } from "../../../../components/staff/ui";

export default function CommercePaymentsPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();

  return (
    <>
      <PageHeader
        eyebrow="Commerce"
        title="Payment review"
        explain="Match submitted transfers against your statement, then settle or reject. Settling applies membership and referral credit."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <CommerceOrders
        guildId={guild}
        scopes={data?.guild.scopes ?? []}
        title="Review queue"
        defaultStatus="claimed"
      />
    </>
  );
}
