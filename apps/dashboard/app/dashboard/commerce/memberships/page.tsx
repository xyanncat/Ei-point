"use client";
// Commerce · Memberships & referrals: what will live here, stated honestly.
import Link from "next/link";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function CommerceMembershipsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Commerce"
        title="Memberships & referrals"
        explain="Rewards that apply to INR checkouts once settlement is confirmed."
      />
      <div className="sf-grid-2">
        <Panel title="Membership activation" detail="Granted by the same transactional module as the orders table.">
          <Empty
            title="Not connected yet"
            detail="Active memberships, renewal state and claim history appear here once the commerce module publishes them."
          />
        </Panel>
        <Panel title="Referral credit" detail="Whole-row credit applied at settlement.">
          <Empty
            title="Not connected yet"
            detail="Referral earnings and claim tracking appear here with the rewards module."
          />
        </Panel>
      </div>
      <Panel title="Customer-facing pages" detail="These stay available on the public site.">
        <ul className="sf-list">
          <li><span className="sf-dot" /><Link href="/membership">Membership services</Link><span className="sf-dim">public</span></li>
          <li><span className="sf-dot" /><Link href="/referrals">How referrals work</Link><span className="sf-dim">public</span></li>
          <li><span className="sf-dot" /><Link href="/verify">Verify an order</Link><span className="sf-dim">public</span></li>
        </ul>
      </Panel>
    </>
  );
}
