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
import { HealthBadge, PageHeader, Panel, Empty, stateText, stamp } from "../../../components/staff/ui";
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
        <div className="sf-field" style={{ maxWidth: "24rem", marginBottom: "1rem" }}>
          <span>Server</span>
          <select
            value={guild}
            onChange={(event) => {
              setOpenBot("");
              setGuild(event.target.value);
            }}
          >
            {guilds.map((entry) => (
              <option key={entry.guildId} value={entry.guildId}>
                {entry.name}
                {isMaster ? " (master)" : ""}
              </option>
            ))}
          </select>
        </div>
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
              <table className="sf-table">
                <thead>
                  <tr>
                    <th>Bot</th>
                    <th>Status</th>
                    <th>Modules</th>
                    <th>Seen</th>
                    <th>
                      <span className="sr-only">Setup</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((card) => {
                    const meta = botsMeta(card.botKey);
                    const isOpen = openBot === card.botKey;
                    return (
                      <tr key={card.botKey}>
                        <td>
                          <strong>{meta.name}</strong>
                          <br />
                          <span className="sf-dim">{meta.summary}</span>
                        </td>
                        <td>
                          <HealthBadge
                            health={card.stale ? "stale" : card.state}
                            text={card.stale ? "Stale" : stateText(card.state)}
                          />
                        </td>
                        <td>{(card.modules ?? []).join(", ") || "None assigned"}</td>
                        <td className="sf-num">{stamp(card.updatedAt)}</td>
                        <td>
                          <button
                            className="sf-ghost"
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setOpenBot(isOpen ? "" : card.botKey)}
                          >
                            {isOpen ? "Close" : "Set up"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
