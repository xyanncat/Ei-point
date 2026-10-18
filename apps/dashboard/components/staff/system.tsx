"use client";
// Global administration panels (owner/admin only). Everything here is
// fleet-wide — the pages say so explicitly. The API authorizes every action;
// secret values are only revealed on explicit request and hide again after 30s.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { Empty, Panel } from "./ui";

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

function useAdminPanel<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
    } catch (cause) {
      setError(failText(cause));
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = useCallback(
    async (action: () => Promise<unknown>, message: string) => {
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
    },
    [load],
  );
  return { data, busy, error, notice, run };
}

function Notices({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && <p className="sf-note sf-error" role="alert">{error}</p>}
      {notice && (
        <p className="sf-note sf-ok-note sf-checkmark" role="status">
          {notice}
        </p>
      )}
    </>
  );
}

type Guild = { guild_id: string; name: string; approved: boolean; owner_id?: string };

export function GuildsPanel() {
  const { data, busy, error, notice, run } = useAdminPanel<{ guilds: Guild[] }>("/api/admin/guilds");
  const [draft, setDraft] = useState({ guild_id: "", name: "", owner_id: "", approved: true });
  const guilds = data?.guilds ?? [];
  return (
    <Panel title="Server approvals" detail="Only approved servers can use the fleet. Revoking takes effect on the next bot check.">
      <Notices error={error} notice={notice} />
      {guilds.map((guild) => (
        <div className="sf-actions" key={guild.guild_id}>
          <span>
            {guild.name} · <span className="sf-num">{guild.guild_id}</span> · {guild.approved ? "Approved" : "Revoked"}
          </span>
          <button
            className="sf-ghost"
            disabled={busy}
            onClick={() => void run(() => mutate("/api/admin/guilds", { ...guild, approved: !guild.approved }, "PUT"), "Guild authorization saved.")}
          >
            {guild.approved ? "Revoke" : "Approve"}
          </button>
        </div>
      ))}
      {!guilds.length && <Empty title="No guild records" />}
      <form
        className="sf-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => mutate("/api/admin/guilds", draft, "PUT"), "Guild record saved.");
        }}
      >
        <label className="sf-field"><span>Guild ID</span><input required value={draft.guild_id} disabled={busy} onChange={(e) => setDraft({ ...draft, guild_id: e.target.value })} /></label>
        <label className="sf-field"><span>Name</span><input required value={draft.name} disabled={busy} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="sf-field"><span>Owner ID</span><input value={draft.owner_id} disabled={busy} onChange={(e) => setDraft({ ...draft, owner_id: e.target.value })} /></label>
        <label className="sf-check"><input type="checkbox" checked={draft.approved} disabled={busy} onChange={(e) => setDraft({ ...draft, approved: e.target.checked })} />Approved</label>
        <button className="sf-ghost" disabled={busy}>Save guild</button>
      </form>
    </Panel>
  );
}

type Secret = { name: string; masked: string; updated_at: string };

export function VaultPanel() {
  const { data, busy, error, notice, run } = useAdminPanel<{ secrets: Secret[] }>("/api/admin/secrets");
  const [draft, setDraft] = useState({ name: "", value: "" });
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null);
  const secrets = data?.secrets ?? [];

  useEffect(() => {
    if (!revealed) return;
    const timeout = setTimeout(() => setRevealed(null), 30000);
    return () => clearTimeout(timeout);
  }, [revealed]);

  return (
    <Panel title="Stored secrets" detail="Values stay masked; a revealed value hides itself after 30 seconds.">
      <Notices error={error} notice={notice} />
      {secrets.map((secret) => (
        <div className="sf-actions" key={secret.name}>
          <span>
            {secret.name} · <span className="sf-num">{secret.masked}</span>
          </span>
          <button
            className="sf-ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await mutate<{ value: string }>(`/api/admin/secrets/${encodeURIComponent(secret.name)}/reveal`, { confirmation: true }, "POST");
                setRevealed({ name: secret.name, value: result.value });
              }, "Secret reveal acknowledged.")
            }
          >
            Reveal {secret.name}
          </button>
          <button
            className="sf-ghost"
            disabled={busy}
            onClick={() => void run(() => mutate(`/api/admin/secrets/${encodeURIComponent(secret.name)}`, {}, "DELETE"), "Secret deleted.")}
          >
            Delete {secret.name}
          </button>
        </div>
      ))}
      {!secrets.length && <Empty title="Vault is empty" />}
      {revealed && (
        <div className="sf-savebar">
          <label className="sf-field"><span>Revealed {revealed.name}</span><input readOnly value={revealed.value} /></label>
          <button className="sf-ghost" onClick={() => setRevealed(null)}>Hide now</button>
        </div>
      )}
      <form
        className="sf-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await mutate(`/api/admin/secrets/${encodeURIComponent(draft.name)}`, { value: draft.value }, "PUT");
            setDraft({ name: "", value: "" });
          }, "Secret stored in vault.");
        }}
      >
        <label className="sf-field"><span>Secret name</span><input required autoComplete="off" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="sf-field"><span>New secret value</span><input required type="password" autoComplete="new-password" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></label>
        <button className="sf-ghost" disabled={busy}>Store or replace secret</button>
      </form>
    </Panel>
  );
}

type InfraAccount = { id: string; provider: string; account_name: string; secret_ref: string; endpoint: string; region: string; enabled: boolean; metadata: Record<string, unknown> };

const EMPTY_ACCOUNT = { id: "", provider: "postgres", account_name: "", secret_ref: "", endpoint: "", region: "", enabled: true, metadata: "{}" };

export function AccountsPanel() {
  const { data, busy, error, notice, run } = useAdminPanel<{ accounts: InfraAccount[] }>("/api/admin/accounts");
  const [draft, setDraft] = useState(EMPTY_ACCOUNT);
  const [formError, setFormError] = useState("");
  const accounts = data?.accounts ?? [];

  return (
    <Panel title="Infrastructure accounts" detail="Provider metadata only — credentials stay in the vault and are referenced by secret name.">
      <Notices error={formError || error} notice={notice} />
      {accounts.map((account) => (
        <div className="sf-actions" key={account.id}>
          <span>
            {account.account_name} · {account.provider} · {account.enabled ? "Enabled" : "Disabled"} · vault <span className="sf-num">{account.secret_ref}</span>
          </span>
          <button
            className="sf-ghost"
            disabled={busy}
            onClick={() => setDraft({ ...account, endpoint: account.endpoint ?? "", region: account.region ?? "", metadata: JSON.stringify(account.metadata ?? {}, null, 2) })}
          >
            Edit {account.account_name}
          </button>
          <button
            className="sf-ghost"
            disabled={busy}
            onClick={() => void run(() => mutate(`/api/admin/accounts/${encodeURIComponent(account.id)}`, {}, "DELETE"), "Infrastructure account deleted.")}
          >
            Delete {account.account_name}
          </button>
        </div>
      ))}
      {!accounts.length && <Empty title="No infrastructure accounts" />}
      <form
        className="sf-actions"
        onSubmit={(event) => {
          event.preventDefault();
          setFormError("");
          let metadata: unknown;
          try {
            metadata = JSON.parse(draft.metadata);
          } catch {
            setFormError("Account metadata must be valid JSON.");
            return;
          }
          if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
            setFormError("Account metadata must be a JSON object.");
            return;
          }
          const { id, ...values } = draft;
          void run(async () => {
            await mutate(id ? `/api/admin/accounts/${encodeURIComponent(id)}` : "/api/admin/accounts", { ...values, metadata }, id ? "PATCH" : "POST");
            setDraft(EMPTY_ACCOUNT);
          }, "Infrastructure account saved.");
        }}
      >
        <label className="sf-field">
          <span>Provider</span>
          <select value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })}>
            {["postgres", "redis", "mongodb"].map((provider) => <option key={provider}>{provider}</option>)}
          </select>
        </label>
        <label className="sf-field"><span>Account name</span><input required value={draft.account_name} onChange={(e) => setDraft({ ...draft, account_name: e.target.value })} /></label>
        <label className="sf-field"><span>Vault secret reference</span><input required pattern="[A-Z][A-Z0-9_]{0,99}" value={draft.secret_ref} onChange={(e) => setDraft({ ...draft, secret_ref: e.target.value })} /></label>
        <label className="sf-field"><span>Endpoint (no credentials)</span><input value={draft.endpoint} onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })} /></label>
        <label className="sf-field"><span>Region</span><input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} /></label>
        <label className="sf-check"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />Account enabled</label>
        <label className="sf-field" style={{ minWidth: "18rem" }}><span>Account metadata JSON</span><textarea value={draft.metadata} onChange={(e) => setDraft({ ...draft, metadata: e.target.value })} /></label>
        <button className="sf-ghost" disabled={busy}>{draft.id ? "Save account changes" : "Add account"}</button>
        {draft.id && (
          <button type="button" className="sf-ghost" disabled={busy} onClick={() => setDraft(EMPTY_ACCOUNT)}>Cancel edit</button>
        )}
      </form>
    </Panel>
  );
}
