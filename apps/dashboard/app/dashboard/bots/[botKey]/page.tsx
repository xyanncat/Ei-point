"use client";
// Bot · Overview: assigned capabilities and cross-links into the workspace.
import { use } from "react";
import Link from "next/link";
import { useOverview } from "../../../../components/staff/use-overview";
import { Empty, Panel } from "../../../../components/staff/ui";

const RELATED: Record<string, { label: string; href: string }[]> = {
  kafka: [
    { label: "Moderation · Incidents", href: "/dashboard/moderation" },
    { label: "Moderation · Protection rules", href: "/dashboard/moderation/protection" },
  ],
  cipher: [
    { label: "Commerce · Payment review", href: "/dashboard/commerce/payments" },
    { label: "Commerce · Orders", href: "/dashboard/commerce" },
  ],
  silverwolf: [{ label: "Community · Cards & economy", href: "/dashboard/community/economy" }],
  himiko: [
    { label: "Community · Welcome & leave", href: "/dashboard/community" },
    { label: "Community · Announcements", href: "/dashboard/community/announcements" },
  ],
};

export default function BotOverviewPage({ params }: { params: Promise<{ botKey: string }> }) {
  const { botKey } = use(params);
  const { data } = useOverview();
  const card = data?.cards.find((c) => c.botKey === botKey);
  const related = RELATED[botKey] ?? [];

  return (
    <>
      <Panel title="Assigned capabilities" detail="Modules this bot runs for the selected server.">
        {card?.modules?.length ? (
          <ul className="sf-list">
            {card.modules.map((module) => (
              <li key={module}>
                <span className="sf-dot" />
                {module}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No modules reported" />
        )}
      </Panel>
      {related.length ? (
        <Panel title="Where this bot's work lives" detail="Feature workflows stay on their own pages — nothing is duplicated here.">
          <ul className="sf-list">
            {related.map((link) => (
              <li key={link.href}>
                <span className="sf-dot" />
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
