"use client";
// Local tab bar for sections with subpages. Rendered by each section's
// layout; the sidebar stays at eight destinations (owner task 2026-10-19).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS } from "./sections";

export function SectionTabs({ section }: { section: string }) {
  const path = usePathname();
  const definition = SECTIONS.find((entry) => entry.href === section);
  if (!definition?.tabs) return null;
  return (
    <nav className="sf-tabs" aria-label={`${definition.label} pages`}>
      {definition.tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={path === tab.href ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
