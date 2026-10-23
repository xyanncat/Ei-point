"use client";
// The shell every page sits in: the film, the navigation, the footer.
// Application surfaces (sign-in, the account area) ask for their own chrome
// by rendering outside the public frame.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PublicNav } from "./public-nav";
import { ScrollProgress } from "./motion";
import { WorldProvider } from "./world";

const FOOTER_COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Explore",
    links: [
      ["/", "Home"],
      ["/services", "Services"],
      ["/about", "About"],
      ["/docs", "Docs"],
    ],
  },
  {
    title: "Account",
    links: [
      ["/account", "My account"],
      ["/account/orders", "Purchase logs"],
      ["/login", "Sign in"],
      ["/verify", "Verify an order"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["/terms", "Terms of service"],
      ["/policy", "Privacy & policy"],
      ["/membership", "Membership"],
      ["/referrals", "Referrals"],
    ],
  },
];

function Footer() {
  return (
    <footer className="ei-site-footer">
      <div className="ei-site-footer__inner">
        <div>
          <Link href="/" className="site-brand">
            Ei point
          </Link>
          <p>
            Account management for Genshin Impact, Honkai: Star Rail, Wuthering
            Waves, Neverness to Everness and Arknights: Endfield. Paid over UPI,
            Razorpay or USDT, verified here, settled by staff.
          </p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title}>
            <h2>{column.title}</h2>
            <ul>
              {column.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href}>{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}

export function SiteFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  // The sign-in screen and the account area are dense, reading surfaces: the
  // film steps back so the data stays legible.
  const appSurface =
    path === "/login" || path.startsWith("/account") || path.startsWith("/dev");

  return (
    <WorldProvider tone={appSurface ? "calm" : "cinema"}>
      <ScrollProgress />
      {appSurface ? (
        <div className="ei-dashboard-frame">{children}</div>
      ) : (
        <div className="ei-public">
          <PublicNav />
          <main id="main">{children}</main>
          <Footer />
        </div>
      )}
    </WorldProvider>
  );
}
