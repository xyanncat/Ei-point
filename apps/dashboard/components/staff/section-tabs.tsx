"use client";
// Local tab bar for sections with subpages. Admin-only tabs stay hidden for
// other staff — hiding is navigation, not authorization: every destination
// and API still enforces permissions on its own.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS } from "./sections";
import { useStaff } from "./staff-context";

export function SectionTabs({ section }: { section: string }) {
  const path = usePathname();
  const { isAdmin } = useStaff();
  const definition = SECTIONS.find((entry) => entry.href === section);
  const tabs = (definition?.tabs ?? []).filter((tab) => !tab.admin || isAdmin);
  if (!definition || !tabs.length) return null;
  return (
    <nav className="sf-tabs" aria-label={`${definition.label} pages`}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={path === tab.href ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
