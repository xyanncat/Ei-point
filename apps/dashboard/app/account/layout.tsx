"use client";
// My Account shell: compact account navigation for customers. Uses the shared
// Kafka staff styles so both areas speak one visual language. Customer account
// data is not connected yet (see the overview) — the shell exists so the
// structure is real, not fabricated.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import "../../components/staff/staff.css";

const TABS = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "My orders" },
  { href: "/account/membership", label: "Membership" },
  { href: "/account/referrals", label: "Referrals" },
  { href: "/account/settings", label: "Account settings" },
];

export default function AccountLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="sf-app account-area">
      <div className="sf-content">
        <nav className="sf-tabs" aria-label="Account pages">
          {TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} aria-current={path === tab.href ? "page" : undefined}>
              {tab.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
