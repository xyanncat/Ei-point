"use client";
// System section (owner/admin only): guild approvals, staff scopes, secret
// vault and infrastructure accounts. Relocated from "Administration".
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { MODULE_LABELS } from "../../lib/workspace-config-schema";
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

type Guild = { guild_id: string; name: string; approved: boolean; owner_id?: string };
type Scope = { guild_id: string; role_id: string; scope: string };
type Secret = { name: string; masked: string; updated_at: string };
type InfraAccount = { id: string; provider: string; account_name: string; secret_ref: string; endpoint: string; region: string; enabled: boolean; metadata: Record<string, unknown> };

export function SystemPanels({ guildId }: { guildId: string }) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [staff, setStaff] = useState<Scope[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [accounts, setAccounts] = useState<InfraAccount[]>([]);
  const [guildDraft, setGuildDraft] = useState({ guild_id: "", name: "", owner_id: "", approved: true });
  const [scopeDraft, setScopeDraft] = useState({ guild_id: guildId, role_id: "", scope: "read" });
  const [secretDraft, setSecretDraft] = useState({ name: "", value: "" });
  const [accountDraft, setAccountDraft] = useState({ id: "", provider: "postgres", account_name: "", secret_ref: "", endpoint: "", region: "", enabled: true, metadata: "{}" });
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [g, s, v, a] = await Promise.all([
        api<{ guilds: Guild[] }>("/api/admin/guilds"),
        api<{ scopes: Scope[] }>("/api/admin/staff-scopes"),
        api<{ secrets: Secret[] }>("/api/admin/secrets"),
        api<{ accounts: InfraAccount[] }>("/api/admin/accounts"),
      ]);
      setGuilds(g.guilds);
      setStaff(s.scopes);
      setSecrets(v.secrets);
      setAccounts(a.accounts);
    } catch (cause) {
      setError(failText(cause));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!revealed) return;
    const timeout = setTimeout(() => setRevealed(null), 30000);
    return () => clearTimeout(timeout);
  }, [revealed]);

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
    <>
      {error && <p className="sf-note sf-error" role="alert">{error}</p>}
      {notice && <p className="sf-note sf-ok-note sf-checkmark" role="status">{notice}</p>}

      <Panel title="Approved servers" detail="Only approved servers can use the fleet. Revoking takes effect on the next bot check.">
        {guilds.map((g) => (
          <div className="sf-actions" key={g.guild_id}>
            <span>
              {g.name} · <span className="sf-num">{g.guild_id}</span> · {g.approved ? "Approved" : "Revoked"}
            </span>
            <button className="sf-ghost" disabled={busy} onClick={() => void run(() => mutate("/api/admin/guilds", { ...g, approved: !g.approved }, "PUT"), "Guild authorization saved.")}>
              {g.approved ? "Revoke" : "Approve"}
            </button>
          </div>
        ))}
        <form className="sf-actions" onSubmit={(e) => { e.preventDefault(); void run(() => mutate("/api/admin/guilds", guildDraft, "PUT"), "Guild record saved."); }}>
          <label className="sf-field"><span>Guild ID</span><input required value={guildDraft.guild_id} disabled={busy} onChange={(e) => setGuildDraft({ ...guildDraft, guild_id: e.target.value })} /></label>
          <label className="sf-field"><span>Name</span><input required value={guildDraft.name} disabled={busy} onChange={(e) => setGuildDraft({ ...guildDraft, name: e.target.value })} /></label>
          <label className="sf-field"><span>Owner ID</span><input value={guildDraft.owner_id} disabled={busy} onChange={(e) => setGuildDraft({ ...guildDraft, owner_id: e.target.value })} /></label>
          <label className="sf-check"><input type="checkbox" checked={guildDraft.approved} disabled={busy} onChange={(e) => setGuildDraft({ ...guildDraft, approved: e.target.checked })} />Approved</label>
          <button className="sf-ghost" disabled={busy}>Save guild</button>
        </form>
      </Panel>

      <Panel title="Staff access" detail="Grant scopes to Discord roles for staff who are not owners or managers.">
        {staff.map((s, i) => (
          <div className="sf-actions" key={i}>
            <span><span className="sf-num">{s.guild_id}</span> · role <span className="sf-num">{s.role_id}</span> · {s.scope}</span>
            <button className="sf-ghost" disabled={busy} onClick={() => void run(() => mutate("/api/admin/staff-scopes", s, "DELETE"), "Staff scope removed.")}>Remove scope</button>
          </div>
        ))}
        {!staff.length && <Empty title="No staff scopes" />}
        <form className="sf-actions" onSubmit={(e) => { e.preventDefault(); void run(() => mutate("/api/admin/staff-scopes", scopeDraft, "PUT"), "Staff scope granted."); }}>
          <label className="sf-field"><span>Guild ID</span><input required value={scopeDraft.guild_id} onChange={(e) => setScopeDraft({ ...scopeDraft, guild_id: e.target.value })} /></label>
          <label className="sf-field"><span>Discord role ID</span><input required value={scopeDraft.role_id} onChange={(e) => setScopeDraft({ ...scopeDraft, role_id: e.target.value })} /></label>
          <label className="sf-field"><span>Scope</span>
            <select value={scopeDraft.scope} onChange={(e) => setScopeDraft({ ...scopeDraft, scope: e.target.value })}>
              {[...new Set(["read", "commerce-settle", ...Object.keys(MODULE_LABELS)])].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button className="sf-ghost" disabled={busy}>Grant scope</button>
        </form>
      </Panel>

      <Panel title="Secret vault" detail="Values stay masked. A revealed value hides itself after 30 seconds.">
        {secrets.map((s) => (
          <div className="sf-actions" key={s.name}>
            <span>{s.name} · <span className="sf-num">{s.masked}</span></span>
            <button className="sf-ghost" disabled={busy} onClick={() => void run(async () => {
              const result = await mutate<{ value: string }>(`/api/admin/secrets/${encodeURIComponent(s.name)}/reveal`, { confirmation: true }, "POST");
              setRevealed({ name: s.name, value: result.value });
            }, "Secret reveal acknowledged.")}>Reveal {s.name}</button>
            <button className="sf-ghost" disabled={busy} onClick={() => void run(() => mutate(`/api/admin/secrets/${encodeURIComponent(s.name)}`, {}, "DELETE"), "Secret deleted.")}>Delete {s.name}</button>
          </div>
        ))}
        {!secrets.length && <Empty title="Vault is empty" />}
        {revealed && (
          <div className="sf-savebar">
            <label className="sf-field"><span>Revealed {revealed.name}</span><input readOnly value={revealed.value} /></label>
            <button className="sf-ghost" onClick={() => setRevealed(null)}>Hide now</button>
          </div>
        )}
        <form className="sf-actions" onSubmit={(e) => { e.preventDefault(); void run(async () => {
          await mutate(`/api/admin/secrets/${encodeURIComponent(secretDraft.name)}`, { value: secretDraft.value }, "PUT");
          setSecretDraft({ name: "", value: "" });
        }, "Secret stored in vault."); }}>
          <label className="sf-field"><span>Secret name</span><input required autoComplete="off" value={secretDraft.name} onChange={(e) => setSecretDraft({ ...secretDraft, name: e.target.value })} /></label>
          <label className="sf-field"><span>New secret value</span><input required type="password" autoComplete="new-password" value={secretDraft.value} onChange={(e) => setSecretDraft({ ...secretDraft, value: e.target.value })} /></label>
          <button className="sf-ghost" disabled={busy}>Store or replace secret</button>
        </form>
      </Panel>

      <Panel title="Infrastructure accounts" detail="Provider metadata only — credentials stay in the vault and are referenced by secret name.">
        {accounts.map((a) => (
          <div className="sf-actions" key={a.id}>
            <span>{a.account_name} · {a.provider} · {a.enabled ? "Enabled" : "Disabled"} · vault <span className="sf-num">{a.secret_ref}</span></span>
            <button className="sf-ghost" disabled={busy} onClick={() => setAccountDraft({ ...a, endpoint: a.endpoint ?? "", region: a.region ?? "", metadata: JSON.stringify(a.metadata ?? {}, null, 2) })}>Edit {a.account_name}</button>
            <button className="sf-ghost" disabled={busy} onClick={() => void run(() => mutate(`/api/admin/accounts/${encodeURIComponent(a.id)}`, {}, "DELETE"), "Infrastructure account deleted.")}>Delete {a.account_name}</button>
          </div>
        ))}
        {!accounts.length && <Empty title="No infrastructure accounts" />}
        <form className="sf-actions" onSubmit={(e) => {
          e.preventDefault();
          let metadata: unknown;
          try {
            metadata = JSON.parse(accountDraft.metadata);
          } catch {
            setError("Account metadata must be valid JSON.");
            return;
          }
          if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
            setError("Account metadata must be a JSON object.");
            return;
          }
          const { id, ...values } = accountDraft;
          void run(async () => {
            await mutate(id ? `/api/admin/accounts/${encodeURIComponent(id)}` : "/api/admin/accounts", { ...values, metadata }, id ? "PATCH" : "POST");
            setAccountDraft({ id: "", provider: "postgres", account_name: "", secret_ref: "", endpoint: "", region: "", enabled: true, metadata: "{}" });
          }, "Infrastructure account saved.");
        }}>
          <label className="sf-field"><span>Provider</span>
            <select value={accountDraft.provider} onChange={(e) => setAccountDraft({ ...accountDraft, provider: e.target.value })}>
              {["postgres", "redis", "mongodb"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="sf-field"><span>Account name</span><input required value={accountDraft.account_name} onChange={(e) => setAccountDraft({ ...accountDraft, account_name: e.target.value })} /></label>
          <label className="sf-field"><span>Vault secret reference</span><input required pattern="[A-Z][A-Z0-9_]{0,99}" value={accountDraft.secret_ref} onChange={(e) => setAccountDraft({ ...accountDraft, secret_ref: e.target.value })} /></label>
          <label className="sf-field"><span>Endpoint (no credentials)</span><input value={accountDraft.endpoint} onChange={(e) => setAccountDraft({ ...accountDraft, endpoint: e.target.value })} /></label>
          <label className="sf-field"><span>Region</span><input value={accountDraft.region} onChange={(e) => setAccountDraft({ ...accountDraft, region: e.target.value })} /></label>
          <label className="sf-check"><input type="checkbox" checked={accountDraft.enabled} disabled={busy} onChange={(e) => setAccountDraft({ ...accountDraft, enabled: e.target.checked })} />Account enabled</label>
          <label className="sf-field" style={{ minWidth: "18rem" }}><span>Account metadata JSON</span><textarea value={accountDraft.metadata} onChange={(e) => setAccountDraft({ ...accountDraft, metadata: e.target.value })} /></label>
          <button className="sf-ghost" disabled={busy}>{accountDraft.id ? "Save account changes" : "Add account"}</button>
          {accountDraft.id && (
            <button type="button" className="sf-ghost" disabled={busy} onClick={() => setAccountDraft({ id: "", provider: "postgres", account_name: "", secret_ref: "", endpoint: "", region: "", enabled: true, metadata: "{}" })}>Cancel edit</button>
          )}
        </form>
      </Panel>
    </>
  );
}
