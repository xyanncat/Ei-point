"use client";
// Bot detail: signals, assigned capabilities, bot state and command
// permissions — the relocated fleet-admin functions, scoped to one bot.
import { use } from "react";
import { useOverview } from "../../../../components/staff/use-overview";
import { useStaff } from "../../../../components/staff/staff-context";
import { botsMeta } from "../../../../components/staff/bots-meta";
import { BotStatePanel, CommandPermissionsPanel } from "../../../../components/staff/panels";
import { HealthBadge, PageHeader, Panel, Empty, stamp, stateText } from "../../../../components/staff/ui";

export default function BotDetailPage({ params }: { params: Promise<{ botKey: string }> }) {
  const { botKey } = use(params);
  const { guild } = useStaff();
  const { data, busy, error, refresh } = useOverview();
  const card = data?.cards.find((c) => c.botKey === botKey);
  const meta = botsMeta(botKey);
  const scopes = data?.guild.scopes ?? [];
  const canOperate = scopes.includes("*");

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
      {card ? (
        <div className="sf-grid-2">
          <Panel title="Signals" detail="Health is reported per process; unknown beats a false healthy.">
            <dl className="sf-kv">
              <div><dt>Process</dt><dd><HealthBadge health={card.stale ? "stale" : card.state} text={card.stale ? "Stale" : stateText(card.state)} /></dd></div>
              <div><dt>Discord gateway</dt><dd>{card.stale ? "Unknown" : stateText(card.gateway)}</dd></div>
              <div><dt>Database</dt><dd>{card.stale ? "Unknown" : card.dbReady ? "Ready" : "Unavailable"}</dd></div>
              <div><dt>Provider</dt><dd>{card.stale ? "Unknown" : stateText(card.provider ?? "unknown")}</dd></div>
              <div><dt>Latency</dt><dd>{card.latencyMs == null || card.stale ? "Unavailable" : `${card.latencyMs} ms`}</dd></div>
              <div><dt>Last heartbeat</dt><dd className="sf-num">{stamp(card.updatedAt)}</dd></div>
            </dl>
            <p className="sf-dim">Assigned modules: {(card.modules ?? []).join(", ") || "None configured"}</p>
          </Panel>
          <BotStatePanel guildId={guild} botKey={botKey} canOperate={canOperate} />
          <CommandPermissionsPanel guildId={guild} botKey={botKey} canOperate={canOperate} />
        </div>
      ) : (
        <Panel title="Bot not found">
          <Empty
            title={`No bot named “${botKey}” is assigned to this server`}
            detail="It may be registered under another key, or the registry has not published it yet."
          />
        </Panel>
      )}
    </>
  );
}
