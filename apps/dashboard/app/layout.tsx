import type { ReactNode } from "react";
import "./globals.css";
import "@fontsource-variable/cinzel";
import "@fontsource-variable/manrope";
import { SiteFrame } from "../components/site-frame";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0a0f",
};

export const metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3000",
  ),
  title: "Ei point — play here, belong here",
  description:
    "30-day account management across Genshin Impact, Honkai: Star Rail, Wuthering Waves, Neverness to Everness and Arknights: Endfield. Paid over UPI, Razorpay or USDT, verified on this site, settled by staff.",
  icons: { icon: "/media/logo.svg" },
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
