"use client";
// Public primary navigation: Home · Services · Cards · Membership · Help,
// with utility links (Verify order, My account) kept out of the primary row.
// Staff workspace stays available from the account menu and the footer.
import { usePathname } from "next/navigation";
import { BrandMark } from "./brand-mark";

const PRIMARY: [string, string][] = [
  ["/", "Home"],
  ["/services", "Services"],
  ["/cards", "Cards"],
  ["/membership", "Membership"],
  ["/help", "Help"],
];

const UTILITY: [string, string][] = [
  ["/verify", "Verify order"],
  ["/account", "My account"],
];

export function PublicNav() {
  const path = usePathname();
  if (path.startsWith("/dashboard") || path.startsWith("/dev")) return null;
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Primary" className="site-nav">
      <a href="/" className="site-brand">
        <BrandMark />
        Ei point
      </a>
      {PRIMARY.map(([href, label]) => (
        <a key={href} href={href} aria-current={active(href) ? "page" : undefined}>
          {label}
        </a>
      ))}
      {UTILITY.map(([href, label], index) => (
        <a
          key={href}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          className={index === 0 ? "site-utility" : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
