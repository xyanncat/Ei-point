"use client";
// My Account · Referrals. Honest state plus the working public entry points.
import Link from "next/link";
import { Empty, PageHeader, Panel } from "../../../components/staff/ui";

export default function AccountReferralsPage() {
  return (
    <>
      <PageHeader
        eyebrow="My account"
        title="Referrals"
        explain="Your referral link, joins and earned credit."
      />
      <Panel title="Not connected yet" detail="Referral tracking appears here once the rewards module exposes it.">
        <Empty
          title="Ask staff for your link for now"
          detail="Referral links are issued on the game servers today. Joins attach to the calendar month and are paid out by staff."
        />
        <p className="sf-actions">
          <Link className="sf-primary" href="/referrals">
            How referrals work
          </Link>
          <Link className="sf-ghost" href="/help">
            Help &amp; FAQ
          </Link>
        </p>
      </Panel>
    </>
  );
}
