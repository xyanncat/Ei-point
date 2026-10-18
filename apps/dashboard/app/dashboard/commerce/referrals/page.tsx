"use client";
// Commerce · Referrals: referral credit and claim records for this server.
import Link from "next/link";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function CommerceReferralsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Commerce"
        title="Referrals"
        explain="Referral joins, earned credit and payouts for this server."
      />
      <Panel title="Referral records" detail="Whole-row credit applied at settlement; rewards expire at the month boundary.">
        <Empty
          title="Not connected yet"
          detail="Referral joins and earned credit appear here once the rewards module exposes them."
        />
      </Panel>
      <Panel title="Customer-facing pages" detail="These stay available on the public site.">
        <ul className="sf-list">
          <li><span className="sf-dot" /><Link href="/referrals">How referrals work</Link><span className="sf-dim">public</span></li>
        </ul>
      </Panel>
    </>
  );
}
