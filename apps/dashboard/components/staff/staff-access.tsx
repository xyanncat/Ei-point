"use client";
// Staff access for one server: role-scoped grants against the admin API.
// Relocated verbatim from the System page so the function has one home.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { MODULE_LABELS } from "../../lib/workspace-config-schema";
import { Empty, Panel } from "./ui";

type Scope = { guild_id: string; role_id: string; scope: string };

async function mutate<T>(path: string, body: unknown, method = "PATCH") {
  const { csrfToken } = await api<{ csrfToken: string }>("/api/auth/csrf");
  return api<T>(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
}

function failText(cause: unknown) {
  return cause instanceof ApiError && cause.status === 403
    ? `Access denied: ${cause.message}`
    : cause instanceof Error
      ? cause.message
      : "Request failed.";
}

export function StaffAccessPanel({ guildId }: { guildId: string }) {
  const [rows, setRows] = useState<Scope[]>([]);
  const [draft, setDraft] = useState({ role_id: "", scope: "read" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api<{ scopes: Scope[] }>("/api/admin/staff-scopes");
      setRows(result.scopes.filter((entry) => entry.guild_id === guildId));
    } catch (cause) {
      setError(failText(cause));
    }
  }, [guildId]);

  useEffect(() => {
    setRows([]);
    setError("");
    setNotice("");
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      await load();
    } catch (cause) {
      setError(failText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Role grants"
      detail={`Scopes apply to the selected server only (${guildId || "no server selected"}).`}
    >
      {error && <p className="sf-note sf-error" role="alert">{error}</p>}
      {notice && <p className="sf-note sf-ok-note sf-checkmark" role="status">{notice}</p>}
      {rows.length ? (
        <table className="sf-table">
          <thead>
            <tr><th>Discord role</th><th>Scope</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.role_id}:${row.scope}`}>
                <td className="sf-num">{row.role_id}</td>
                <td>{row.scope}</td>
                <td>
                  <button
                    className="sf-ghost"
                    disabled={busy}
                    onClick={() => void run(() => mutate("/api/admin/staff-scopes", row, "DELETE"), "Grant removed.")}
                  >
                    Remove {row.scope}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title="No grants for this server" detail="Owners and managers keep access through their own roles." />
      )}
      <form
        className="sf-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () => mutate("/api/admin/staff-scopes", { guild_id: guildId, ...draft }, "PUT"),
            "Grant added.",
          );
        }}
      >
        <label className="sf-field">
          <span>Discord role ID</span>
          <input required value={draft.role_id} onChange={(e) => setDraft({ ...draft, role_id: e.target.value })} />
        </label>
        <label className="sf-field">
          <span>Scope</span>
          <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })}>
            {[...new Set(["read", "commerce-settle", ...Object.keys(MODULE_LABELS)])].map((scope) => (
              <option key={scope}>{scope}</option>
            ))}
          </select>
        </label>
        <button className="sf-ghost" disabled={busy}>Grant scope</button>
      </form>
    </Panel>
  );
}
