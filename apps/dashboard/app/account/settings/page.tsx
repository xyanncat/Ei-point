"use client";
// My Account · Account settings. The signed-in identity and sign-out are the
// real, working functions here; everything else is marked honestly.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../../lib/api";
import { PageHeader, Panel } from "../../../components/staff/ui";

type Me = { user: { id: string; name: string }; demo?: boolean };

export default function AccountSettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Me>("/api/auth/me")
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setSignedOut(true);
      });
  }, []);

  async function signOut() {
    setBusy(true);
    try {
      const token = await api<{ csrfToken: string }>("/api/auth/csrf");
      await api("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": token.csrfToken } });
      setMe(null);
      setSignedOut(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="My account"
        title="Account settings"
        explain="Identity and session controls for this browser."
      />
      <Panel title="Signed-in identity" detail="Checkout and future account features bind to this Discord identity — never to a typed ID.">
        {me ? (
          <>
            <dl className="sf-kv">
              <div>
                <dt>Discord name</dt>
                <dd>{me.user.name}</dd>
              </div>
              <div>
                <dt>Discord ID</dt>
                <dd className="sf-num">{me.user.id}</dd>
              </div>
            </dl>
            <p className="sf-actions">
              <button className="sf-ghost" onClick={() => void signOut()} disabled={busy}>
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </p>
          </>
        ) : (
          <>
            <p>{signedOut ? "You are signed out." : "Loading…"}</p>
            {signedOut ? (
              <p className="sf-actions">
                <Link className="sf-primary" href={`/login?returnTo=${encodeURIComponent("/account/settings")}`}>
                  Continue with Discord
                </Link>
              </p>
            ) : null}
          </>
        )}
      </Panel>
      <Panel title="Preferences" detail="Notification and privacy preferences arrive with the account backend.">
        <p className="sf-dim">Nothing to configure here yet — this page will grow when customer accounts ship.</p>
      </Panel>
    </>
  );
}
