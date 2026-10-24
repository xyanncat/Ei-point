"use client";
// Servers tab. One tab per server — the servers with Ei point bots where this
// person is an owner or an administrator (the master sees every server, not
// only their own). Each tab holds that server's bots and their full setup.
import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useStaff } from "../../../components/staff/staff-context";
import { useOverview } from "../../../components/staff/use-overview";
import {
  BotStatePanel,
  CommandPermissionsPanel,
  ModuleConfig,
  ServerSettingsPanel,
} from "../../../components/staff/panels";
import { StaffAccessPanel } from "../../../components/staff/staff-access";
import { HealthBadge, PageHeader, Panel, Empty, stateText, stamp } from "../../../components/staff/ui";
import { Stagger, StaggerItem } from "../../../components/motion";
import { botsMeta } from "../../../components/staff/bots-meta";
import { MasterServerControls } from "../../../components/account/master-controls";

export default function ServersPage() {
  const { guilds, guild, setGuild, guildName, role, isAdmin, isMaster } = useStaff();
  const { data, busy, error, refresh } = useOverview();
  const [openBot, setOpenBot] = useState<string>("");
  const reduce = useReducedMotion();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const scopes = data?.guild.scopes ?? [];
  const canOperate = scopes.includes("*");
  const cards = data?.cards ?? [];

  function selectGuild(id: string) {
    setOpenBot("");
    setGuild(id);
  }

  function onTabKey(event: React.KeyboardEvent, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % guilds.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + guilds.length) % guilds.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = guilds.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectGuild(guilds[next].guildId);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <PageHeader
        eyebrow={isMaster ? "Master view" : "Your servers"}
        title="Servers"
        explain={
          isMaster
            ? "Every approved server on the platform, with the bots inside it and the power to remove one."
            : "Servers with Ei point bots where you are an owner or an administrator. Pick one to configure its bots."
        }
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {error ? (
        <div className="sf-note sf-error" role="alert">
          <strong>
            {data
              ? "Live update unavailable. Showing the last snapshot."
              : "This view could not be loaded."}
          </strong>
          <p>{error}</p>
        </div>
      ) : null}

      {guilds.length > 0 ? (
        <div className="world-tabs" role="tablist" aria-label="Servers">
          {guilds.map((entry, index) => {
            const selected = entry.guildId === guild;
            return (
              <button
                key={entry.guildId}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`server-tab-${entry.guildId}`}
                aria-selected={selected}
                aria-controls="server-panel"
                tabIndex={selected ? 0 : -1}
                className="world-tab"
                onClick={() => selectGuild(entry.guildId)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {selected && !reduce ? (
                  <motion.span
                    layoutId="server-tab-active"
                    className="world-tab__pill"
                    aria-hidden="true"
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  />
                ) : null}
                <span className="world-tab__label">{entry.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!guild ? (
        <Empty
          title={busy ? "Loading servers…" : "No servers yet"}
          detail={
            busy
              ? undefined
              : "Invite one of the Ei point bots to a server where you are an owner or an administrator and it appears here."
          }
        />
      ) : (
        <div
          role="tabpanel"
          id="server-panel"
          aria-labelledby={`server-tab-${guild}`}
          tabIndex={0}
        >
          <Panel
            title={`Bots in ${guildName || "this server"}`}
            detail="Open a bot to configure it. Everything here applies to this server only."
          >
            {cards.length ? (
              <Stagger className="sf-cards" amount={0.1}>
                {cards.map((card) => {
                  const meta = botsMeta(card.botKey);
                  const isOpen = openBot === card.botKey;
                  return (
                    <StaggerItem key={card.botKey}>
                      <article className="sf-card">
                        <div className="sf-card__top">
                          <span className="sf-card__mark" aria-hidden="true">
                            {meta.name.charAt(0)}
                          </span>
                          <div>
                            <h3 className="sf-card__title">{meta.name}</h3>
                            <p className="sf-card__sub">{meta.summary}</p>
                          </div>
                        </div>
                        <div className="sf-card__meta">
                          <HealthBadge
                            health={card.stale ? "stale" : card.state}
                            text={card.stale ? "Stale" : stateText(card.state)}
                          />
                          <span className="sf-card__sub">
                            {(card.modules ?? []).join(" · ") || "No modules"}
                          </span>
                        </div>
                        <div className="sf-card__meta">
                          <span className="sf-num">Seen {stamp(card.updatedAt)}</span>
                        </div>
                        <div className="sf-card__foot">
                          <button
                            className="sf-ghost"
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setOpenBot(isOpen ? "" : card.botKey)}
                          >
                            {isOpen ? "Close" : "Set up"}
                          </button>
                        </div>
                      </article>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            ) : (
              <Empty
                title={busy ? "Loading bots…" : "No bots in this server"}
                detail={
                  busy
                    ? undefined
                    : "Add this server to the bot registry to see its services here."
                }
              />
            )}
          </Panel>

          {openBot ? (
            <div className="world-stack" style={{ marginTop: "1.2rem" }}>
              <BotStatePanel guildId={guild} botKey={openBot} canOperate={canOperate} />
              <ModuleConfig
                guildId={guild}
                modules={
                  cards.find((card) => card.botKey === openBot)?.modules ?? []
                }
                canOperate={canOperate}
              />
              <CommandPermissionsPanel
                guildId={guild}
                botKey={openBot}
                canOperate={canOperate}
              />
              {isAdmin || isMaster ? (
                <StaffAccessPanel guildId={guild} />
              ) : null}
            </div>
          ) : null}

          {canOperate || isMaster ? (
            <div style={{ marginTop: "1.2rem" }}>
              <ServerSettingsPanel guildId={guild} canOperate={canOperate} />
            </div>
          ) : null}

          {isMaster ? (
            <div style={{ marginTop: "1.2rem" }}>
              <MasterServerControls guildId={guild} guildName={guildName} />
            </div>
          ) : null}

          <p className="world-note" style={{ marginTop: "1.2rem" }}>
            Signed in as {role}. {isMaster
              ? "As the master account you see every approved server and no bot can refuse your commands."
              : "You see servers with Ei point bots where you are an owner or an administrator."}
          </p>
        </div>
      )}
    </>
  );
}
