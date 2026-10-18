"use client";
// My Account · Overview. Honest about the gap: there is no customer account
// backend yet, so nothing here fabricates orders, membership or credit.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../lib/api";
import { Empty, PageHeader, Panel } from "../../components/staff/ui";

type Me = { user: { id: string; name: string }; demo?: boolean };

export default function AccountOverviewPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    api<Me>("/api/auth/me")
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setSignedOut(true);
      });
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="My account"
        title={me ? `Welcome back, ${me.user.name}` : signedOut ? "Sign in to see your account" : "Loading your account…"}
        explain="Purchases, membership and referrals in one place. Your data will always be scoped to your signed-in Discord identity."
        actions={
          signedOut ? (
            <Link className="sf-primary" href={`/login?returnTo=${encodeURIComponent("/account")}`}>
              Continue with Discord
            </Link>
          ) : (
            <Link className="sf-ghost" href="/verify">
              Verify an order
            </Link>
          )
        }
      />

      <div className="sf-grid-2">
        <Panel title="Membership status" detail="Shown here once claim tracking ships.">
          <Empty
            title="Not connected yet"
            detail="Active membership and renewal state appear here after the commerce module publishes customer records."
          />
        </Panel>
        <Panel title="Orders requiring action" detail="Orders waiting on your payment step.">
          <Empty
            title="Not connected yet"
            detail="Order history by account arrives with the customer dashboard. Until then, use your order's verification link."
          />
          <p className="sf-actions">
            <Link className="sf-ghost" href="/account/orders">
              Look up an order
            </Link>
          </p>
        </Panel>
      </div>

      <Panel title="Recent orders" detail="Newest first, scoped to your account.">
        <Empty
          title="No account-linked orders yet"
          detail={
            signedOut
              ? "Sign in with Discord to connect future purchases to this account."
              : "Purchases made with your Discord sign-in will appear here once order history is connected."
          }
        />
      </Panel>

      <Panel title="Referral summary" detail="Your link, joins and earned credit.">
        <Empty
          title="Not connected yet"
          detail="Referral credit appears here once the rewards module exposes it. Rules live on the referrals page."
        />
      </Panel>

      <div className="sf-note" role="status">
        {signedOut
          ? "Sign in with Discord to connect your purchases to this account."
          : me?.demo
            ? "Demo session — sample identity only, no personal data."
            : `Signed in as ${me?.user.name ?? "…"}.`}
        {" "}Staff? The <Link href="/dashboard">staff workspace</Link> lives separately.
      </div>
    </>
  );
}
