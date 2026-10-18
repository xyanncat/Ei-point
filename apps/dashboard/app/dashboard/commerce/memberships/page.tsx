"use client";
// Commerce · Memberships: membership activation records for this server.
import Link from "next/link";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function CommerceMembershipsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Commerce"
        title="Memberships"
        explain="Membership orders and activation state, applied at settlement."
      />
      <Panel title="Membership records" detail="Granted by the same transactional module as the orders table.">
        <Empty
          title="Not connected yet"
          detail="Active memberships, renewal state and claim history appear here once the commerce module publishes them."
        />
      </Panel>
      <Panel title="Customer-facing pages" detail="These stay available on the public site.">
        <ul className="sf-list">
          <li><span className="sf-dot" /><Link href="/membership">Membership services</Link><span className="sf-dim">public</span></li>
          <li><span className="sf-dot" /><Link href="/verify">Verify an order</Link><span className="sf-dim">public</span></li>
        </ul>
      </Panel>
    </>
  );
}
