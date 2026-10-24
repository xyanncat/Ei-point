"use client";
// The account area. Three tabs, and the middle one only exists for the
// operator and the master:
//
//   Servers        the servers this person invited bots to, with the bot setup
//   Services       admin + master: the catalogue they own
//   Purchase logs  their orders
//
// The master sees every server, not just their own, and the tab that strips
// a bot out of a server.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StaffProvider, useStaff } from "../../components/staff/staff-context";
import "../../components/staff/staff.css";

function AccountTabs() {
  const path = usePathname();
  const { role, isAdmin, isMaster, realRole, preview, setPreview } = useStaff();
  const tabs = [
    { href: "/account/servers", label: "Servers" },
    ...(isAdmin || isMaster
      ? [{ href: "/account/services", label: "Services" }]
      : []),
    { href: "/account/orders", label: "Purchase logs" },
  ];
  const active = (href: string) =>
    path === href || (href === "/account/servers" && path === "/account");
  // Testing switch. Rendered for the master identity alone: walk the admin
  // and user segments with one login. The API enforces the preview too, so
  // the data on screen is the data that segment really gets.
  const segments = ["master", "admin", "user"] as const;
  return (
    <>
      <nav className="world-tabs" aria-label="Account sections">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active(tab.href) ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
        <span className={`world-pill${isMaster ? " world-pill--master" : isAdmin ? " world-pill--admin" : ""}`}>
          {role}
        </span>
      </nav>
      {realRole === "master" ? (
        <div className="world-row" role="group" aria-label="Test the account as another segment">
          <span className="world-note">View as</span>
          {segments.map((segment) => {
            const selected =
              (preview ?? "master") === segment;
            return (
              <button
                key={segment}
                type="button"
                className="icon-button"
                aria-pressed={selected}
                onClick={() =>
                  setPreview(segment === "master" ? null : segment)
                }
              >
                {segment === "master" ? "Master" : segment === "admin" ? "Admin" : "User"}
              </button>
            );
          })}
        </div>
      ) : null}
      {preview ? (
        <p className="world-note" role="status">
          Previewing as {preview}. The screens and the data match that
          segment; master controls stay out of reach until you switch back.
        </p>
      ) : null}
    </>
  );
}

function AccountChrome({ children }: { children: ReactNode }) {
  const { boot, user, error, reference, retry, logout } = useStaff();
  const path = usePathname();

  if (boot === "loading")
    return <div className="world-empty">Loading your account…</div>;

  if (boot === "login")
    return (
      <div className="sf-app account-area">
        <div className="sf-content">
          <div className="world-empty">
            <h1 className="world-title world-title--sm">Sign in to continue</h1>
            <p className="world-note">
              Your servers, bot setup and purchase logs live behind a Discord
              sign-in. Nothing is visible to anyone else.
            </p>
            <p>
              <Link className="ei-action" href="/login">
                Sign in with Discord
              </Link>
            </p>
          </div>
        </div>
      </div>
    );

  if (boot === "failed")
    return (
      <div className="sf-app account-area">
        <div className="sf-content">
          <div className="world-empty">
            <p className="world-note world-note--error">{error}</p>
            {reference ? (
              <p className="world-note">Reference: {reference}</p>
            ) : null}
            <button className="ei-action" onClick={retry} type="button">
              Retry
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="sf-app account-area">
      <div className="sf-content">
        <header className="account-head">
          <div>
            <p className="world-eyebrow">Account</p>
            <h1 className="world-title world-title--sm">
              {user?.name ?? "Your account"}
            </h1>
          </div>
          <div className="world-row">
            <AccountTabs />
            <button
              type="button"
              className="icon-button"
              onClick={() => void logout()}
            >
              Sign out
            </button>
          </div>
        </header>
        {path === "/account" ? null : null}
        {children}
      </div>
    </div>
  );
}

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <StaffProvider>
      <AccountChrome>{children}</AccountChrome>
    </StaffProvider>
  );
}
