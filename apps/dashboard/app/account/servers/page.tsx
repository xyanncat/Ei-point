"use client";
// Servers tab. Each server is its own square block. Opening a block steps
// inside that server: its workspace with grouped sub-pages (General,
// Management, TTS / Chatbot / Music setup, Ticket system, Moderation) lives
// there, not on the list. Users and admins see servers with Ei point bots
// where they are owners or administrators; the master sees every approved
// server.
import { useEffect, useRef, useState } from "react";
import { useStaff } from "../../../components/staff/staff-context";
import { useOverview } from "../../../components/staff/use-overview";
import { PageHeader, Empty } from "../../../components/staff/ui";
import { ServerWorkspace } from "../../../components/account/server-sections";

export default function ServersPage() {
  const { guilds, guild, setGuild, guildName, role, isAdmin, isMaster } = useStaff();
  const { data, busy, error, refresh } = useOverview();
  // Inside the server box, or on the boxes list. A shared ?server= link lands
  // straight inside.
  const [inside, setInside] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("server") !== null,
  );
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const scopes = data?.guild.scopes ?? [];
  const canOperate = scopes.includes("*");

  function openServer(id: string) {
    setGuild(id);
    setInside(true);
  }

  useEffect(() => {
    if (inside) workspaceRef.current?.scrollIntoView({ block: "start" });
  }, [inside, guild]);

  return (
    <>
      <PageHeader
        eyebrow={isMaster ? "Master view" : "Your servers"}
        title="Servers"
        explain={
          isMaster
            ? "Every approved server on the platform. Open a block to step inside that server."
            : "Servers with Ei point bots where you are an owner or an administrator. Open a block to step inside."
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

      {!inside || !guild ? (
        <>
          {guilds.length ? (
            <div className="sf-server-grid" role="group" aria-label="Servers">
              {guilds.map((entry) => (
                <button
                  key={entry.guildId}
                  type="button"
                  className="sf-server-box"
                  onClick={() => openServer(entry.guildId)}
                >
                  <span className="sf-server-box__mark" aria-hidden="true">
                    {entry.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="sf-server-box__name">{entry.name}</span>
                  <span className="sf-server-box__hint">Open</span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title={busy ? "Loading servers…" : "No servers yet"}
              detail={
                busy
                  ? undefined
                  : "Invite one of the Ei point bots to a server where you are an owner or an administrator and it appears here."
              }
            />
          )}
        </>
      ) : (
        <div ref={workspaceRef} className="sf-server-inside">
          <div className="sf-server-inside__head">
            <button type="button" className="sf-ghost" onClick={() => setInside(false)}>
              ← All servers
            </button>
            <h2 className="sf-server-inside__title">{guildName || "Server"}</h2>
          </div>
          <ServerWorkspace
            key={guild}
            guildId={guild}
            guildName={guildName}
            role={role}
            isAdmin={isAdmin}
            isMaster={isMaster}
            data={data}
            canOperate={canOperate}
          />
        </div>
      )}
    </>
  );
}
