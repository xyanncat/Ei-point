import type { ReactNode } from "react";
import "./globals.css";
import "@fontsource-variable/outfit";
import "@fontsource-variable/nunito-sans";
import { SiteFrame } from "../components/site-frame";
import "./public-kafka.css";

export const metadata = {
  title: "Ei point — Command Center",
  description:
    "Manage your community, bots and server operations with Ei point.",
  icons: { icon: "/art/kafka-tea.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteFrame>{children}</SiteFrame>
      </body>
    </html>
  );
}
