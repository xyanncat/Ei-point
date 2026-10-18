"use client";
// Commerce: orders, payment review, and the archive service catalog.
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useOverview } from "../../../components/staff/use-overview";
import { useStaff } from "../../../components/staff/staff-context";
import { CommerceOrders } from "../../../components/staff/orders";
import { Empty, PageHeader, Panel } from "../../../components/staff/ui";

type CatalogItem = { sku: string; name: string; priceMinor: number; currency: string };

export default function CommercePage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  useEffect(() => {
    api<{ items: CatalogItem[] }>("/api/catalog")
      .then((r) => setCatalog(r.items))
      .catch(() => setCatalog([]));
  }, []);
  return (
    <>
      <PageHeader
        eyebrow="Staff workspace"
        title="Commerce"
        explain="Purchases, settlement and the service catalog. Payment review lives here — never in a general controls page."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <CommerceOrders guildId={guild} scopes={data?.guild.scopes ?? []} />
      <Panel title="Service catalog" detail="Archive definitions with original INR prices. Staff confirm availability before payment.">
        {catalog.length ? (
          <table className="sf-table">
            <thead>
              <tr><th>SKU</th><th>Service</th><th>Price</th></tr>
            </thead>
            <tbody>
              {catalog.map((item) => (
                <tr key={item.sku}>
                  <td className="sf-num">{item.sku}</td>
                  <td>{item.name}</td>
                  <td>{(item.priceMinor / 100).toFixed(2)} {item.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="Catalog unavailable" detail="Start the API to load the service catalog." />
        )}
      </Panel>
      <Panel title="Memberships & referrals" detail="Rewards auto-apply to INR checkouts as whole-row credit once settlement is confirmed.">
        <p className="sf-dim">
          Membership activation, referral credit and claim tracking follow from the same transactional module that
          powers this orders table.
        </p>
      </Panel>
    </>
  );
}
