"use client";
// My Account · My orders. Account-scoped order history is not connected yet;
// the working alternative (order verification links) stays front and centre.
import Link from "next/link";
import { Empty, PageHeader, Panel } from "../../../components/staff/ui";

export default function AccountOrdersPage() {
  return (
    <>
      <PageHeader
        eyebrow="My account"
        title="My orders"
        explain="Every order placed with your Discord sign-in, with status and next steps."
      />
      <Panel title="Not connected yet" detail="Order history by account ships with the customer dashboard.">
        <Empty
          title="Use your verification link for now"
          detail="Every order carries a verifiable link or token. Open the verification page to see status, amount and the next step for a specific order."
        />
        <p className="sf-actions">
          <Link className="sf-primary" href="/verify">
            Verify an order
          </Link>
          <Link className="sf-ghost" href="/help">
            Help &amp; FAQ
          </Link>
        </p>
      </Panel>
    </>
  );
}
