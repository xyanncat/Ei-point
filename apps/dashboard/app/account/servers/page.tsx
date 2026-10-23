"use client";
// Servers tab. The servers this person invited bots to, and the setup for
// every bot inside them. The master sees every server on the platform, not
// only their own, and can pull a bot out of one.
import { useState } from "react";
import { useStaff } from "../../../components/staff/staff-context";
import { useOverview } from "../../../components/staff/use-overview";
import {
  BotStatePanel,
  CommandPermissionsPanel,
  ModuleConfig,
  ServerSettingsPanel,
} from "../../../components/staff/panels";
import { StaffAccessPanel } from "../../../components/staff/staff-access";
import { HealthBadge, PageHeader, Panel, Empty, ServerSwitcher, stateText, stamp } from "../../../components/staff/ui";
import { Stagger, StaggerItem } from "../../../components/motion";
import { botsMeta } from "../../../components/staff/bots-meta";
import { MasterServerControls } from "../../../components/account/master-controls";

export default function ServersPage() {
  const { guilds, guild, setGuild, guildName, role, isAdmin, isMaster } = useStaff();
  const { data, busy, error, refresh } = useOverview();
  const [openBot, setOpenBot] = useState<string>("");

  const scopes = data?.guild.scopes ?? [];
  const canOperate = scopes.includes("*");
  const cards = data?.cards ?? [];

  return (
    <>
      <PageHeader
        eyebrow={isMaster ? "Master view" : "Your servers"}
        title="Servers"
        explain={
          isMaster
            ? "Every approved server on the platform, with the bots inside it and the power to remove one."
            : "The servers you invited bots to. Open a bot to set up how it behaves in that server."
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

      {guilds.length > 1 ? (
        <ServerSwitcher
          label="Server"
          options={guilds.map((entry) => ({ id: entry.guildId, name: entry.name }))}
          value={guild}
          suffix={isMaster ? "master" : undefined}
          onChange={(id) => {
            setOpenBot("");
            setGuild(id);
          }}
        />
      ) : null}

      {!guild ? (
        <Empty
          title={busy ? "Loading servers…" : "No servers yet"}
          detail={
            busy
              ? undefined
              : "Invite one of the Ei point bots to a server and it appears here."
          }
        />
      ) : (
        <>
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
              : "You only ever see the servers you invited a bot to."}
          </p>
        </>
      )}
    </>
  );
}
