"use client";
// Public navigation. Primary: Home · Services · About · Docs. Utility: the
// account link and a sign-in link.
//
// There is no sound or play control here. The film and the soundtrack are not
// features of the site, they are the site, and they run on their own.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "./brand-mark";

const PRIMARY: [string, string][] = [
  ["/", "Home"],
  ["/services", "Services"],
  ["/about", "About"],
  ["/docs", "Docs"],
];

const SECONDARY: [string, string][] = [
  ["/membership", "Membership"],
  ["/referrals", "Referrals"],
  ["/cards", "Cards"],
  ["/verify", "Verify order"],
];

export function PublicNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  const active = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

  return (
    <nav aria-label="Primary" className="site-nav">
      <div className="site-nav__inner">
        <Link href="/" className="site-brand">
          <BrandMark />
          Ei point
        </Link>

        <div className="site-nav__links">
          {PRIMARY.map(([href, label]) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </div>

        <div className="site-nav__tools">
          <Link href="/account" className="icon-button" aria-label="My account">
            Account
          </Link>
          <button
            type="button"
            className="icon-button site-nav__burger"
            aria-expanded={open}
            aria-controls="site-nav-drawer"
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden="true">{open ? "Close" : "Menu"}</span>
          </button>
        </div>
      </div>

      <div
        id="site-nav-drawer"
        className="site-nav__drawer"
        data-open={open ? "true" : "false"}
        hidden={!open}
      >
        <div className="site-nav__drawer-inner">
          {PRIMARY.map(([href, label]) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}>
              {label}
            </Link>
          ))}
          {SECONDARY.map(([href, label]) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}>
              {label}
            </Link>
          ))}
          <Link href="/login">Sign in</Link>
        </div>
      </div>
    </nav>
  );
}
