"use client";
// My account (redesign brief): customer area sharing the Kafka system.
// Unconnected features are marked honestly rather than faked.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../lib/api";
import "../../components/staff/staff.css";

type Me = { user: { id: string; name: string }; demo?: boolean };

export default function AccountPage() {
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
    <div className="sf-app">
      <div className="sf-content">
        <header className="sf-head">
          <div className="sf-head-copy">
            <p className="sf-eyebrow">My account</p>
            <h1>{me ? `Welcome back, ${me.user.name}` : signedOut ? "Sign in to see your account" : "Loading your account…"}</h1>
            <p className="sf-explain">
              Orders, membership and referrals in one place. The public site stays for browsing.
            </p>
          </div>
          <div className="sf-head-actions">
            {signedOut ? (
              <Link className="sf-primary" href="/login">Continue with Discord</Link>
            ) : (
              <Link className="sf-ghost" href="/dashboard">Staff workspace</Link>
            )}
          </div>
        </header>

        <div className="sf-grid-2">
          <section className="sf-panel">
            <h2>Orders</h2>
            <p className="sf-dim">
              Look up an order by its verification link or token; the full history arrives with the customer
              dashboard rollout.
            </p>
            <p><Link className="sf-ghost" href="/verify">Verify an order</Link></p>
          </section>
          <section className="sf-panel">
            <h2>Membership</h2>
            <p className="sf-dim">Active membership and renewal state appear here once claim tracking ships.</p>
            <p><Link className="sf-ghost" href="/membership">See membership services</Link></p>
          </section>
          <section className="sf-panel">
            <h2>Referrals</h2>
            <p className="sf-dim">Your referral link and earned credit appear here once the rewards module exposes them.</p>
            <p><Link className="sf-ghost" href="/referrals">How referrals work</Link></p>
          </section>
          <section className="sf-panel">
            <h2>Collection</h2>
            <p className="sf-dim">Card collection and trades are planned with the economy rollout.</p>
            <p><Link className="sf-ghost" href="/cards">Browse cards</Link></p>
          </section>
        </div>

        <div className="sf-note" role="status">
          {signedOut
            ? "Sign in with Discord to connect your purchases to this account."
            : me?.demo
              ? "Demo session — sample data only."
              : `Signed in as ${me?.user.name ?? "…"}.`}
        </div>
      </div>
    </div>
  );
}
