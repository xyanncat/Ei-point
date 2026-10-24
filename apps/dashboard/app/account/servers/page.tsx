"use client";
// Servers tab. Each server is its own square block; opening one reveals its
// workspace — grouped sub-pages (General, Management, Ticket system,
// Moderation) with every setting inside. Users and admins see servers with
// Ei point bots where they are owners or administrators; the master sees
// every approved server.
import { useStaff } from "../../../components/staff/staff-context";
import { useOverview } from "../../../components/staff/use-overview";
import { PageHeader, Empty } from "../../../components/staff/ui";
import { ServerWorkspace } from "../../../components/account/server-sections";

export default function ServersPage() {
  const { guilds, guild, setGuild, guildName, role, isAdmin, isMaster } = useStaff();
  const { data, busy, error, refresh } = useOverview();

  const scopes = data?.guild.scopes ?? [];
  const canOperate = scopes.includes("*");

  return (
    <>
      <PageHeader
        eyebrow={isMaster ? "Master view" : "Your servers"}
        title="Servers"
        explain={
          isMaster
            ? "Every approved server on the platform. Open a block to work inside that server."
            : "Servers with Ei point bots where you are an owner or an administrator. Open a block to configure its bots."
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

      {guilds.length ? (
        <div className="sf-server-grid" role="group" aria-label="Servers">
          {guilds.map((entry) => {
            const selected = entry.guildId === guild;
            return (
              <button
                key={entry.guildId}
                type="button"
                className="sf-server-box"
                data-selected={selected ? "true" : "false"}
                aria-pressed={selected}
                onClick={() => setGuild(entry.guildId)}
              >
                <span className="sf-server-box__mark" aria-hidden="true">
                  {entry.name.charAt(0).toUpperCase()}
                </span>
                <span className="sf-server-box__name">{entry.name}</span>
                <span className="sf-server-box__hint">
                  {selected ? "Open below" : "Open"}
                </span>
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
      )}
    </>
  );
}
