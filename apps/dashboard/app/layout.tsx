import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Ei Royality — Command Center",
  description: "Administration dashboard for the Ei Royality six-bot platform.",
};

const PUBLIC_LINKS = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Game services" },
  { href: "/membership", label: "Membership" },
  { href: "/referrals", label: "Referrals" },
  { href: "/verify", label: "Verify order" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <nav aria-label="Primary" className="site-nav">
          <span aria-label="Ei Royality">Ei Royality</span>
          {PUBLIC_LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
