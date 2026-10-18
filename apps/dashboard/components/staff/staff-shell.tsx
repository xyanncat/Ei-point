"use client";
// Staff shell: sidebar (one permanent home per function), server switcher,
// header with breadcrumbs and account menu. Motion is CSS-only (silk nav
// indicator, drawer slide) and reduced-motion aware. Owner brief 2026-10-18.
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Icon } from "../icons";
import { BrandMark } from "../brand-mark";
import { crumbFor, isSectionActive, SECTIONS } from "./sections";
import { useStaff } from "./staff-context";
import "./staff.css";

// Navigation structure (sidebar sections + local tabs) lives in ./sections.

export function StaffShell({ children }: { children: ReactNode }) {
  const { boot, user, guilds, guild, setGuild, guildName, demo, isAdmin, error, reference, retry, logout } = useStaff();
  const path = usePathname();
  const [mobile, setMobile] = useState(false);
  const [account, setAccount] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => setMobile(false), [path]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccount(false);
        setMobile(false);
      }
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) {
        const field = document.getElementById("sf-search");
        if (field instanceof HTMLInputElement) {
          event.preventDefault();
          field.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  const crumb = crumbFor(path);

  if (boot === "login") {
    // Minimal inline notice; the full login page lives at /login.
    return (
      <div className="sf-app">
        <main className="sf-content">
          <section className="sf-panel">
            <h2>Sign in required</h2>
            <p>Your session has ended. Sign in with Discord to open the staff workspace.</p>
            <p>
              <Link className="sf-primary" href="/login">Go to sign in</Link>
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="sf-app">
      <aside className={`sf-side${mobile ? " is-open" : ""}`} aria-label="Workspace sections">
        <Link href="/dashboard" className="sf-wordmark">
          <BrandMark />
          Ei point
        </Link>
        <div className="sf-workspace">
          <label>
            Server
            <select
              aria-label="Choose server"
              value={guild}
              onChange={(e) => setGuild(e.target.value)}
              disabled={!guilds.length}
            >
              {guilds.length ? (
                guilds.map((g) => (
                  <option key={g.guildId} value={g.guildId}>
                    {g.name}
                  </option>
                ))
              ) : (
                <option value="">No server selected</option>
              )}
            </select>
          </label>
        </div>
        <nav className="sf-nav" aria-label="Staff workspace">
          {SECTIONS.filter((n) => !n.admin || isAdmin).map((n) => (
            <Link key={n.href} href={n.href} aria-current={isSectionActive(n, path) ? "page" : undefined}>
              <Icon name={n.icon} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sf-side-foot">
          <Link href="/account">My account</Link>
          <Link href="/">Community website</Link>
        </div>
      </aside>
      {mobile && (
        <button className="sf-nav-scrim" aria-label="Close navigation" onClick={() => setMobile(false)} />
      )}
      <div className="sf-main">
        <header className="sf-top">
          <button
            className="sf-icon-btn sf-burger"
            onClick={() => setMobile(!mobile)}
            aria-label="Toggle navigation"
            aria-expanded={mobile}
          >
            <Icon name="menu" />
          </button>
          <nav className="sf-crumb" aria-label="Breadcrumb">
            Workspace <span className="sf-sep">/</span> <strong>{crumb.label}</strong>
            {crumb.sub ? (
              <>
                <span className="sf-sep">/</span> <strong>{crumb.sub}</strong>
              </>
            ) : null}
          </nav>
          <span className="sf-top-spacer" />
          <a className="sf-icon-btn" href="/dashboard/moderation" aria-label="Open moderation">
            <Icon name="shield" />
          </a>
          <div className="sf-account">
            <button className="sf-icon-btn" aria-expanded={account} onClick={() => setAccount(!account)}>
              {user?.name.slice(0, 1) ?? "?"}
              <strong>{user?.name ?? "Loading"}</strong>
              <Icon name="chevron" />
            </button>
            {account && (
              <div className="sf-account-menu">
                <p>Signed in with Discord</p>
                <strong>{user?.name}</strong>
                <Link href="/account">My account</Link>
                <Link href="/verify">Verify an order</Link>
                <Link href="/">Community website</Link>
                <button
                  onClick={async () => {
                    setLogoutBusy(true);
                    try {
                      await logout();
                    } finally {
                      setLogoutBusy(false);
                    }
                  }}
                  disabled={logoutBusy}
                >
                  <Icon name="logout" />
                  {logoutBusy ? "Signing out…" : "Sign out"}
                </button>
              </div>
            )}
          </div>
        </header>
        <div className="sf-content">
          {demo && (
            <div className="sf-note" role="status">
              Demo workspace — sample data only. Saves are disabled in the preview.
            </div>
          )}
          {boot === "loading" ? (
            <div className="sf-loading" role="status" aria-label="Opening your workspace">
              <div className="sf-skeleton" />
              <div className="sf-skeleton" />
              <div className="sf-skeleton" />
            </div>
          ) : boot === "failed" ? (
            <section className="sf-panel" role="alert">
              <h2>Workspace unavailable</h2>
              <p>{error}</p>
              {reference && <small className="sf-dim">Reference: {reference}</small>}
              <p>
                <button className="sf-primary" onClick={retry}>Try again</button>
              </p>
            </section>
          ) : !guilds.length && !isAdmin ? (
            <section className="sf-panel">
              <h2>No server access yet</h2>
              <p>
                You need to own or manage an approved server, or hold a staff role
                assigned to this dashboard.
              </p>
              <p>
                <button className="sf-primary" onClick={retry}>Check access again</button>
              </p>
            </section>
          ) : (
            <>
              {!guilds.length && (
                <div className="sf-note" role="status">
                  No server access yet — global system controls remain available.
                </div>
              )}
              {children}
            </>
          )}
        </div>
      </div>
      {/* guildName kept available for screen readers when the select is collapsed */}
      <span className="sr-only" aria-live="polite">
        {guildName ? `Selected server: ${guildName}` : ""}
      </span>
    </div>
  );
}
