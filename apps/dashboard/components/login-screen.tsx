"use client";
// Sign-in composition for customers and staff. Exactly one action: the
// Discord OAuth entrypoint, with a sanctioned returnTo so people land back
// where they started. All authentication stays in the API — this screen has
// no auth logic and no bypass; ?error= values only render explanatory copy.
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KafkaScene } from "./kafka-scene";
import { BrandMark } from "./brand-mark";
import "../app/kafka.css";
import "./staff/staff.css";

const MESSAGES: Record<string, string> = {
  denied: "Discord sign-in was cancelled or denied. Nothing changed — try again when you are ready.",
  expired: "That sign-in attempt expired or came from another browser. Start a fresh one below.",
  failed: "Sign-in failed on our side. Try again in a moment — your account is unaffected.",
  "not-configured": "Discord sign-in is not configured on this deployment. Ask server staff to sign you in.",
};

/** Mirrors the API's localReturn rule (app.ts) so links are safe by construction. */
function safeReturn(value: string | null): string {
  if (
    !value ||
    value.length > 300 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n]/.test(value)
  ) {
    return "/account";
  }
  return value;
}

export function LoginScreen() {
  const params = useSearchParams();
  const returnTo = safeReturn(params.get("returnTo"));
  const message = MESSAGES[params.get("error") ?? ""];
  const [busy, setBusy] = useState(false);

  return (
    <div className="sf-app sf-login">
      <main className="sf-login-main">
        <Link href="/" className="sf-wordmark sf-login-mark">
          <BrandMark />
          Ei point
        </Link>
        <section className="sf-hero" aria-label="Sign in">
          <div className="sf-hero-copy">
            <p className="sf-eyebrow">Welcome to Ei point</p>
            <h1>Take your place.</h1>
            <p>
              Sign in with Discord to order services, verify your purchases and
              return to where you left off. Staff accounts open the workspace
              they are authorized for.
            </p>
            {message ? (
              <p className="sf-note sf-error" role="status">
                {message}
              </p>
            ) : null}
            <div className="sf-head-actions">
              <a
                className="sf-primary"
                href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
                onClick={() => setBusy(true)}
                aria-busy={busy}
              >
                {busy ? "Redirecting to Discord…" : "Continue with Discord ↗"}
              </a>
            </div>
            <small className="sf-dim">
              You will return to {returnTo} after signing in. Sign-in never
              grants access by itself — each area checks your permissions.
            </small>
            <Link href="/" style={{ color: "var(--sf-dim)" }}>
              Back to the community website
            </Link>
          </div>
          <div className="sf-hero-art">
            <KafkaScene />
          </div>
        </section>
      </main>
    </div>
  );
}
