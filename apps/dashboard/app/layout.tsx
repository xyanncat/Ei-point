import type { ReactNode } from "react";
import "./globals.css";
import "@fontsource-variable/outfit";
import "@fontsource-variable/nunito-sans";
import { SiteFrame } from "../components/site-frame";

// The favicon is an inline SVG so the site ships no raster brand asset.
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%237d2856'/%3E%3Cstop offset='.55' stop-color='%23cf8aaf'/%3E%3Cstop offset='1' stop-color='%23c7ab7a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='18' fill='url(%23g)'/%3E%3Ccircle cx='32' cy='32' r='11' fill='%23100d13'/%3E%3Ccircle cx='32' cy='32' r='16' fill='none' stroke='%23f3e9e8' stroke-width='2.5'/%3E%3C/svg%3E";

export const metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3000",
  ),
  title: "Ei point — play here, belong here",
  description:
    "30-day account management across Genshin Impact, Honkai: Star Rail, Wuthering Waves, Neverness to Everness and Arknights: Endfield. Paid over UPI, Razorpay or USDT, verified on this site, settled by staff.",
  icons: { icon: FAVICON },
  openGraph: {
    title: "Ei point — play here, belong here",
    description:
      "Account management for five games, verified by staff, settled on site.",
    images: ["/media/posters/ambient.jpg"],
  },
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
