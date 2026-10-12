"use client";
import { usePathname } from "next/navigation";
import { BrandMark } from "./brand-mark";
export function PublicNav() {
  const path = usePathname();
  if (path.startsWith("/dashboard")) return null;
  return (
    <nav aria-label="Primary" className="site-nav">
      <a href="/" className="site-brand">
        <BrandMark />
        Ei point
      </a>
      {[
        ["/services", "Game services"],
        ["/about", "Studio & help"],
        ["/cards", "Cards"],
        ["/membership", "Membership"],
        ["/referrals", "Referrals"],
        ["/verify", "Verify order"],
        ["/dashboard", "Dashboard"],
      ].map(([href, label]) => (
        <a
          key={href}
          href={href}
          aria-current={path === href ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
