"use client";
// My Account · Membership. Honest state plus the working public entry points.
import Link from "next/link";
import { Empty, PageHeader, Panel } from "../../../components/staff/ui";

export default function AccountMembershipPage() {
  return (
    <>
      <PageHeader
        eyebrow="My account"
        title="Membership"
        explain="Your 30-day terms, renewal state and claim history."
      />
      <Panel title="Not connected yet" detail="Membership records appear here once claim tracking ships.">
        <Empty
          title="No account-linked membership yet"
          detail="Membership orders are verified through their own tracking link today. The public page explains what a term includes and current pricing."
        />
        <p className="sf-actions">
          <Link className="sf-primary" href="/membership">
            See membership services
          </Link>
          <Link className="sf-ghost" href="/verify">
            Verify a membership order
          </Link>
        </p>
      </Panel>
    </>
  );
}
