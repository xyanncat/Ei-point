"use client";
// Bot detail shell: identity header + local tabs. Feature workflows stay in
// their own pages; the bot page links to them instead of duplicating.
import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { botsMeta } from "../../../../components/staff/bots-meta";
import { useOverview } from "../../../../components/staff/use-overview";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function BotLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ botKey: string }>;
}) {
  const { botKey } = use(params);
  const path = usePathname();
  const meta = botsMeta(botKey);
  const { data, busy, error, refresh } = useOverview();
  const card = data?.cards.find((c) => c.botKey === botKey);
  const tabs = [
    { href: `/dashboard/bots/${botKey}`, label: "Overview" },
    { href: `/dashboard/bots/${botKey}/configuration`, label: "Configuration" },
    { href: `/dashboard/bots/${botKey}/permissions`, label: "Command permissions" },
    { href: `/dashboard/bots/${botKey}/diagnostics`, label: "Diagnostics" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Bots"
        title={meta.name}
        explain={meta.summary}
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      {error && (
        <div className="sf-note sf-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {!card && !busy ? (
        <Panel title="Bot not found">
          <Empty
            title={`No bot named “${botKey}” is assigned to this server`}
            detail="It may be registered under another key, or the registry has not published it yet."
          />
        </Panel>
      ) : (
        <>
          <nav className="sf-tabs" aria-label="Bot pages">
            {tabs.map((tab) => (
              <Link key={tab.href} href={tab.href} aria-current={path === tab.href ? "page" : undefined}>
                {tab.label}
              </Link>
            ))}
          </nav>
          {children}
        </>
      )}
    </>
  );
}
