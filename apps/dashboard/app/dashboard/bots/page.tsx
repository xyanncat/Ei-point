"use client";
// Bots list (list pattern): filterable table, detail pages per bot.
import { useState } from "react";
import Link from "next/link";
import { useOverview } from "../../../components/staff/use-overview";
import { HealthBadge, PageHeader, Panel, Empty, stamp, stateText } from "../../../components/staff/ui";
import { botsMeta } from "../../../components/staff/bots-meta";

export default function BotsPage() {
  const { data, busy, error, refresh } = useOverview();
  const [search, setSearch] = useState("");
  const cards = data?.cards ?? [];
  const filtered = cards.filter((card) => {
    const meta = botsMeta(card.botKey);
    return `${meta.name} ${meta.summary} ${(card.modules ?? []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });

  return (
    <>
      <PageHeader
        eyebrow="Staff workspace"
        title="Bots"
        explain="Every service assigned to this server, with its process, gateway and database signals."
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
        </div>
      )}
      <Panel title="Assigned bots" detail="Search, then open a bot for its full detail.">
        <div className="sf-field" style={{ maxWidth: "22rem" }}>
          <span>Search bots and modules</span>
          <input
            id="sf-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kafka, music, commerce…"
            aria-label="Search bots and modules"
          />
        </div>
        {filtered.length ? (
          <table className="sf-table">
            <thead>
              <tr>
                <th>Bot</th>
                <th>Status</th>
                <th>Modules</th>
                <th>Seen</th>
                <th><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((card) => {
                const meta = botsMeta(card.botKey);
                return (
                  <tr key={card.botKey}>
                    <td><strong>{meta.name}</strong><br /><span className="sf-dim">{meta.summary}</span></td>
                    <td><HealthBadge health={card.stale ? "stale" : card.state} text={card.stale ? "Stale" : stateText(card.state)} /></td>
                    <td>{(card.modules ?? []).join(", ") || "None assigned"}</td>
                    <td className="sf-num">{stamp(card.updatedAt)}</td>
                    <td><Link href={`/dashboard/bots/${card.botKey}`}>Open details</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty
            title={busy ? "Loading bots…" : search ? "No matching bots" : "No bots assigned"}
            detail={busy ? undefined : search ? "Try a bot name or module." : "Add this server to the bot registry to see its services here."}
          />
        )}
      </Panel>
    </>
  );
}
