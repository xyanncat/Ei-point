"use client";
// Bot · Diagnostics: process, gateway and database signals.
import { use } from "react";
import { useOverview } from "../../../../../components/staff/use-overview";
import { Empty, HealthBadge, Panel, stamp, stateText } from "../../../../../components/staff/ui";

export default function BotDiagnosticsPage({ params }: { params: Promise<{ botKey: string }> }) {
  const { botKey } = use(params);
  const { data } = useOverview();
  const card = data?.cards.find((c) => c.botKey === botKey);

  return (
    <Panel title="Signals" detail="Health is reported per process; unknown beats a false healthy.">
      {card ? (
        <>
          <dl className="sf-kv">
            <div><dt>Process</dt><dd><HealthBadge health={card.stale ? "stale" : card.state} text={card.stale ? "Stale" : stateText(card.state)} /></dd></div>
            <div><dt>Discord gateway</dt><dd>{card.stale ? "Unknown" : stateText(card.gateway)}</dd></div>
            <div><dt>Database</dt><dd>{card.stale ? "Unknown" : card.dbReady ? "Ready" : "Unavailable"}</dd></div>
            <div><dt>Provider</dt><dd>{card.stale ? "Unknown" : stateText(card.provider ?? "unknown")}</dd></div>
            <div><dt>Latency</dt><dd>{card.latencyMs == null || card.stale ? "Unavailable" : `${card.latencyMs} ms`}</dd></div>
            <div><dt>Last heartbeat</dt><dd className="sf-num">{stamp(card.updatedAt)}</dd></div>
          </dl>
          <p className="sf-dim">Assigned modules: {(card.modules ?? []).join(", ") || "None configured"}</p>
        </>
      ) : (
        <Empty title="No signals" detail="This bot is not reporting for the selected server." />
      )}
    </Panel>
  );
}
