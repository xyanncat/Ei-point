"use client";
// Master control. Two things the master has that nobody else does:
//
//   1. the whole list of approved servers, with the bots inside each
//   2. the power to pull a bot out of a server
//
// Removal is deliberate: the button turns into a confirmation, because a bot
// leaving a server stops work that is already in flight.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { PageHeader, Panel, Empty } from "../staff/ui";

type MasterGuild = {
  guildId: string;
  name: string;
  ownerId: string;
  approved: boolean;
  bots: string[];
};

export function MasterServerControls({
  guildId,
  guildName,
}: {
  guildId: string;
  guildName: string;
}) {
  const [guilds, setGuilds] = useState<MasterGuild[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api<{ guilds: MasterGuild[] }>("/api/master/guilds");
      setGuilds(result.guilds);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `${cause.message}`
          : cause instanceof Error
            ? cause.message
            : "The server list could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeBot(botKey: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { csrfToken } = await api<{ csrfToken: string }>("/api/auth/csrf");
      await api(`/api/master/guilds/${encodeURIComponent(guildId)}/bots/${encodeURIComponent(botKey)}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      setNotice(`${botKey} was removed from ${guildName || "this server"}.`);
      setPending("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The bot could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const current = guilds.find((entry) => entry.guildId === guildId);

  return (
    <>
      <PageHeader
        eyebrow="Master control"
        title="Every server"
        explain="The master account sees every approved server on the platform, not only the ones it belongs to. A bot removed here leaves the server and its control state is dropped with it."
      />

      {error ? (
        <p className="world-note world-note--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="world-note world-note--ok" role="status">
          {notice}
        </p>
      ) : null}

      <Panel
        title="Approved servers"
        detail="The selected server is highlighted. Removing a bot takes effect on its next configuration pull."
      >
        {guilds.length ? (
          <table className="sf-table">
            <thead>
              <tr>
                <th>Server</th>
                <th>Owner</th>
                <th>Bots</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {guilds.map((entry) => (
                <tr
                  key={entry.guildId}
                  className={entry.guildId === guildId ? "sf-selected" : undefined}
                >
                  <td>
                    <strong>{entry.name}</strong>
                    <br />
                    <span className="sf-dim">{entry.guildId}</span>
                  </td>
                  <td className="sf-num">{entry.ownerId}</td>
                  <td>{entry.bots.join(", ") || "None"}</td>
                  <td>
                    {entry.approved ? "Approved" : "Pending"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No servers yet"
            detail="Approved servers appear here as soon as one is registered."
          />
        )}
      </Panel>

      {current ? (
        <div style={{ marginTop: "1.2rem" }}>
          <Panel
            title={`Bots in ${current.name}`}
            detail="A removed bot stops working in this server. This cannot be undone from the site."
          >
            {current.bots.length ? (
              <div className="world-stack">
                {current.bots.map((botKey) => (
                  <div className="world-row" key={botKey}>
                    <strong style={{ minWidth: "8rem" }}>{botKey}</strong>
                    {pending === botKey ? (
                      <>
                        <button
                          type="button"
                          className="sf-ghost"
                          disabled={busy}
                          onClick={() => void removeBot(botKey)}
                        >
                          Confirm removal
                        </button>
                        <button
                          type="button"
                          className="sf-ghost"
                          disabled={busy}
                          onClick={() => setPending("")}
                        >
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="sf-ghost"
                        disabled={busy}
                        onClick={() => setPending(botKey)}
                      >
                        Remove {botKey} from this server
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No bots in this server"
                detail="There is nothing running here to remove."
              />
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}
