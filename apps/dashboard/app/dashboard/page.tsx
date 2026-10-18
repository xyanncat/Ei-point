"use client";
// Staff overview (redesign brief §3): what needs attention, compact health
// summary, shortcuts and recent activity. The approved Kafka hero is preserved.
import { useState } from "react";
import Link from "next/link";
import { KafkaScene } from "../../components/kafka-scene";
import { useStaff } from "../../components/staff/staff-context";
import { useOverview } from "../../components/staff/use-overview";
import { HealthBadge, PageHeader, Panel, Empty, stamp, stateText } from "../../components/staff/ui";
import { botsMeta } from "../../components/staff/bots-meta";

export default function OverviewPage() {
  const { guildName, demo } = useStaff();
  const { data, busy, error, reference, refresh, fresh } = useOverview();
  const [showAll, setShowAll] = useState(false);

  const cards = data?.cards ?? [];
  const healthy = cards.filter((c) => !c.stale && c.state === "ok" && c.gateway === "ok" && c.dbReady).length;
  const waste = error
    ? cards.map((c) => ({ ...c, stale: true, state: "unknown" as const, gateway: "unknown" as const }))
    : cards;

  const attention: { id: string; label: string; detail: string; href: string; sev: "warn" | "high" }[] = [];
  for (const card of waste) {
    if (card.stale || card.state !== "ok" || card.gateway === "down") {
      attention.push({
        id: `bot-${card.botKey}`,
        label: `${botsMeta(card.botKey).name} — ${card.stale ? "heartbeat is stale" : stateText(card.state).toLowerCase()}`,
        detail: card.stale
          ? "Health stays unknown until the next heartbeat."
          : `${stateText(card.gateway)} gateway · database ${card.dbReady ? "ready" : "unavailable"}. Open the bot to inspect.`,
        href: `/dashboard/bots/${card.botKey}`,
        sev: card.state === "down" || card.gateway === "down" ? "high" : "warn",
      });
    }
  }
  for (const incident of (data?.incidents ?? []).filter((i) => i.severity === "high").slice(0, 2)) {
    attention.push({
      id: `incident-${incident.id}`,
      label: `Incident — ${incident.kind.replaceAll("-", " ")}`,
      detail: "High severity security event recorded for this server.",
      href: "/dashboard/moderation",
      sev: "high",
    });
  }

  const actions = data?.actions ?? [];
  const visibleActions = showAll ? actions : actions.slice(0, 5);

  return (
    <>
      <section className="sf-hero" aria-label="Server overview">
        <div className="sf-hero-copy">
          <HealthBadge
            health={fresh ? "ok" : "unknown"}
            text={fresh ? "Snapshot current" : "Snapshot needs attention"}
          />
          <h2>
            Every thread.
            <br />
            <em>Under control.</em>
          </h2>
          <p>
            {cards.length
              ? `${healthy} of ${cards.length} bots have fresh, healthy process, gateway and database signals.`
              : "No bots have been assigned to this server yet."}
          </p>
          <div className="sf-hero-stats">
            <div>
              <strong>{cards.length}</strong>
              <span>Assigned bots</span>
            </div>
            <div>
              <strong>{data ? data.incidents.length : "—"}</strong>
              <span>Recent incidents</span>
            </div>
            <div>
              <strong>{data ? stamp(data.fetchedAt) : "—"}</strong>
              <span>Last refresh</span>
            </div>
          </div>
        </div>
        <div className="sf-hero-art">
          <KafkaScene />
        </div>
      </section>

      <PageHeader
        eyebrow={guildName || "Workspace"}
        title="Overview"
        explain="What needs attention, how the fleet is doing and what changed recently."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {error && (
        <div className="sf-note sf-error" role="alert">
          <strong>{data ? "Live update unavailable. Showing the last snapshot." : "This view could not be loaded."}</strong>
          <p>{error}</p>
          {reference && <small>Reference: {reference}</small>}
          <p>
            <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
              Retry
            </button>
          </p>
        </div>
      )}

      <div className="sf-grid-2">
        <Panel title="Needs attention" detail={demo ? "Sample attention items from the demo fixtures." : undefined}>
          {attention.length ? (
            <div className="sf-attention">
              {attention.map((item) => (
                <a key={item.id} href={item.href} data-sev={item.sev}>
                  <span aria-hidden="true">◆</span>
                  <span>
                    <strong>{item.label}</strong>
                    <br />
                    <span className="sf-dim">{item.detail}</span>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <Empty title="All clear" detail="No degraded bots, stale heartbeats or high-severity incidents." />
          )}
        </Panel>

        <Panel title="Shortcuts">
          <ul className="sf-list">
            <li>
              <span className="sf-dot" /><Link href="/dashboard/commerce">Review payments and orders</Link>
            </li>
            <li>
              <span className="sf-dot" /><Link href="/dashboard/community">Create an announcement</Link>
            </li>
            <li>
              <span className="sf-dot" /><Link href="/dashboard/settings">Adjust server settings</Link>
            </li>
            <li>
              <span className="sf-dot" /><Link href="/dashboard/bots">Open the bot fleet</Link>
            </li>
          </ul>
        </Panel>
      </div>

      <Panel
        title="Bot health"
        detail="Compact summary — open a bot for signals, state and permissions. Updates every 30 seconds."
        actions={<Link className="sf-ghost" href="/dashboard/bots">View all</Link>}
      >
        {waste.length ? (
          <table className="sf-table">
            <thead>
              <tr>
                <th>Bot</th>
                <th>Status</th>
                <th>Discord</th>
                <th>Database</th>
                <th>Seen</th>
                <th><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {waste.map((card) => {
                const meta = botsMeta(card.botKey);
                return (
                  <tr key={card.botKey}>
                    <td><strong>{meta.name}</strong><br /><span className="sf-dim">{meta.summary}</span></td>
                    <td><HealthBadge health={card.stale ? "stale" : card.state} text={card.stale ? "Stale" : stateText(card.state)} /></td>
                    <td>{card.stale ? "Unknown" : stateText(card.gateway)}</td>
                    <td>{card.stale ? "Unknown" : card.dbReady ? "Ready" : "Unavailable"}</td>
                    <td className="sf-num">{stamp(card.updatedAt)}</td>
                    <td><Link href={`/dashboard/bots/${card.botKey}`}>Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty
            title={busy ? "Loading server overview…" : "No bots assigned"}
            detail={busy ? undefined : "Add this server to the bot registry to see its services here."}
          />
        )}
      </Panel>

      <Panel
        title="Recent activity"
        detail="Configuration changes recorded for this server."
        actions={
          actions.length > 5 ? (
            <button className="sf-ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : "View all"}
            </button>
          ) : (
            <Link className="sf-ghost" href="/dashboard/activity">View all</Link>
          )
        }
      >
        {visibleActions.length ? (
          <ul className="sf-list">
            {visibleActions.map((action) => (
              <li key={action.id}>
                <span className="sf-dot" />
                <div>
                  <strong>{action.key}</strong> <span className="sf-dim">saved version {action.version}</span>
                </div>
                <time dateTime={action.changedAt}>{stamp(action.changedAt)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="A quiet workspace" detail="Configuration changes will appear here when recorded." />
        )}
      </Panel>
    </>
  );
}
