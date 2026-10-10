import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Ei Royality — Command Center",
  description: "Administration dashboard for the Ei Royality six-bot platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <nav aria-label="Primary">
          <span aria-label="Ei Royality">Ei Royality</span>
          {/* Guild switcher, global search, incident indicator, account menu land here (Phase 4). */}
        </nav>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
