// One registry for staff navigation: the grouped sidebar, the local tab bars
// and the breadcrumbs all derive from this map. Subpages have bookmarkable
// URLs; nothing is a catch-all destination (owner tasks 2026-10-18/19).
import type { IconName } from "../icons";

export interface SectionTab {
  href: string;
  label: string;
  /** Admin-only tabs stay hidden from navigation for other staff. */
  admin?: boolean;
}

export interface SectionDef {
  href: string;
  label: string;
  icon: IconName;
  admin?: boolean;
  /** Sidebar grouping label. */
  group?: string;
  /** Local tabs for sections with subpages. The first tab is the section root. */
  tabs?: SectionTab[];
}

export const SECTIONS: SectionDef[] = [
  { href: "/dashboard", label: "Overview", icon: "overview", group: "Workspace" },
  { href: "/dashboard/bots", label: "Bots", icon: "bots", group: "Workspace" },
  {
    href: "/dashboard/moderation",
    label: "Moderation",
    icon: "shield",
    group: "Server management",
    tabs: [
      { href: "/dashboard/moderation", label: "Incidents" },
      { href: "/dashboard/moderation/cases", label: "Cases" },
      { href: "/dashboard/moderation/protection", label: "Protection rules" },
      { href: "/dashboard/moderation/temporary-actions", label: "Temporary actions" },
    ],
  },
  {
    href: "/dashboard/community",
    label: "Community",
    icon: "cards",
    group: "Server management",
    tabs: [
      { href: "/dashboard/community", label: "Welcome & leave" },
      { href: "/dashboard/community/levels", label: "Levels" },
      { href: "/dashboard/community/announcements", label: "Announcements" },
      { href: "/dashboard/community/economy", label: "Cards & economy" },
    ],
  },
  {
    href: "/dashboard/commerce",
    label: "Commerce",
    icon: "store",
    group: "Server management",
    tabs: [
      { href: "/dashboard/commerce", label: "Orders" },
      { href: "/dashboard/commerce/payments", label: "Payment review" },
      { href: "/dashboard/commerce/services", label: "Services" },
      { href: "/dashboard/commerce/memberships", label: "Memberships" },
      { href: "/dashboard/commerce/referrals", label: "Referrals" },
    ],
  },
  {
    href: "/dashboard/activity",
    label: "Activity",
    icon: "activity",
    group: "Records",
    tabs: [
      { href: "/dashboard/activity", label: "Audit trail" },
      { href: "/dashboard/activity/jobs", label: "Job history" },
    ],
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: "cards",
    group: "Preferences",
    tabs: [
      { href: "/dashboard/settings", label: "Server" },
      { href: "/dashboard/settings/notifications", label: "Notifications" },
      { href: "/dashboard/settings/modules", label: "Modules" },
      { href: "/dashboard/settings/staff", label: "Staff access", admin: true },
    ],
  },
  {
    href: "/dashboard/system",
    label: "System",
    icon: "crown",
    admin: true,
    group: "Owner · admin",
    tabs: [
      { href: "/dashboard/system", label: "Guilds", admin: true },
      { href: "/dashboard/system/integrations", label: "Integrations", admin: true },
      { href: "/dashboard/system/vault", label: "Secret vault", admin: true },
      { href: "/dashboard/system/backups", label: "Backups", admin: true },
    ],
  },
];

/** Sidebar active state: exact root match, prefix match for deeper paths. */
export function isSectionActive(section: SectionDef, path: string) {
  if (section.href === "/dashboard") return path === "/dashboard" || path === "/dashboard/";
  return path === section.href || path.startsWith(`${section.href}/`);
}

/** Longest-prefix match so /dashboard/commerce/payments resolves to Commerce. */
export function sectionFor(path: string): SectionDef {
  let best = SECTIONS[0];
  for (const section of SECTIONS) {
    if (isSectionActive(section, path) && section.href.length >= best.href.length) best = section;
  }
  return best;
}

/** The tab whose URL the current path belongs to (exact match wins). */
export function tabFor(section: SectionDef, path: string): SectionTab | undefined {
  if (!section.tabs) return undefined;
  let match: SectionTab | undefined;
  for (const tab of section.tabs) {
    if (path === tab.href) return tab;
    if (path.startsWith(`${tab.href}/`) && (!match || tab.href.length > match.href.length)) match = tab;
  }
  return match;
}

export function crumbFor(path: string): { label: string; sub: string } {
  const section = sectionFor(path);
  const tab = tabFor(section, path);
  let sub = "";
  if (tab && tab.href !== section.href) {
    sub = tab.label;
  } else {
    const rest = path.slice(section.href.length).replace(/^\//, "");
    if (rest) sub = decodeURIComponent(rest.split("/")[0]).replaceAll("-", " ");
  }
  return { label: section.label, sub };
}

/** Sections grouped for the sidebar, preserving SECTIONS order. */
export function navGroups(sections: SectionDef[]): { group: string; items: SectionDef[] }[] {
  const out: { group: string; items: SectionDef[] }[] = [];
  for (const section of sections) {
    const group = section.group ?? "";
    const last = out[out.length - 1];
    if (last && last.group === group) last.items.push(section);
    else out.push({ group, items: [section] });
  }
  return out;
}
