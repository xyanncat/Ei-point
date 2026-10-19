"use client";
// Relocated workspaces (owner brief): bot state + command permissions live
// with the bot, server settings and module configuration live in Settings.
// Every save reports honestly: "saved" is not "applied".
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import { MODULE_LABELS, type ConfigField, type ConfigValue } from "../../lib/workspace-config-schema";
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="sf-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="sf-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

type Notices = { error: string; notice: string; busy: boolean; run: (action: () => Promise<unknown>, message: string) => Promise<void> };

function useNotices(load: () => Promise<void>): Notices {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
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
  return { error, notice, busy, run };
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

type Bot = { bot_key: string; modules: string[]; enabled: boolean; paused: boolean };
type Permission = { bot_key: string; command: string; role_ids: string[]; enabled: boolean };
type Settings = { notifications_enabled: boolean; server_paused: boolean; notification_preferences: Record<string, boolean> };
type Configuration = { version: number; value: Record<string, ConfigValue>; applied_at?: string | null; updated_at?: string; changed_at?: string };
type Job = { job_id?: string; id?: string; status: string; kind?: string };

export function BotStatePanel({ guildId, botKey, canOperate }: { guildId: string; botKey: string; canOperate: boolean }) {
  const base = `/api/guilds/${encodeURIComponent(guildId)}`;
  const [bot, setBot] = useState<Bot | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ bots: Bot[] }>(`${base}/bot-state`);
      setBot(result.bots.find((b) => b.bot_key === botKey) ?? null);
    } catch {
      setBot(null);
    } finally {
      setLoading(false);
    }
  }, [base, botKey]);
  useEffect(() => {
    void load();
  }, [load]);
  const notices = useNotices(load);
  const disabled = notices.busy || loading || !canOperate || !bot;
  return (
    <Panel title="Bot state" detail="Enable or pause this bot for the selected server. Discord permissions still apply.">
      <Notices error={notices.error} notice={notices.notice} />
      {loading ? (
        <p className="sf-dim" role="status">Loading confirmed server state…</p>
      ) : !bot ? (
        <Empty title="No state record" detail="This bot is not registered in the selected server." />
      ) : (
        <>
          <Check
            label="Enabled"
            checked={bot.enabled}
            disabled={disabled}
            onChange={(value) => void notices.run(() => mutate(`${base}/bot-state`, { bot_key: botKey, enabled: value, paused: bot.paused }), "Bot state saved.")}
          />
          <Check
            label="Paused"
            checked={bot.paused}
            disabled={disabled}
            onChange={(value) => void notices.run(() => mutate(`${base}/bot-state`, { bot_key: botKey, enabled: bot.enabled, paused: value }), "Bot state saved.")}
          />
          {!canOperate && <p className="sf-dim">Read-only: full guild access is required to change bot state.</p>}
        </>
      )}
    </Panel>
  );
}

export function CommandPermissionsPanel({ guildId, botKey, canOperate }: { guildId: string; botKey: string; canOperate: boolean }) {
  const base = `/api/guilds/${encodeURIComponent(guildId)}`;
  const [rows, setRows] = useState<Permission[]>([]);
  const [draft, setDraft] = useState({ command: "", roles: "", enabled: true });
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ permissions: Permission[] }>(`${base}/command-permissions`);
      setRows(result.permissions.filter((p) => p.bot_key === botKey));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [base, botKey]);
  useEffect(() => {
    void load();
  }, [load]);
  const notices = useNotices(load);
  const disabled = notices.busy || loading || !canOperate;
  return (
    <Panel
      title="Command permissions"
      detail="Restrict commands to Discord role IDs. An empty role list permits all roles; Discord permissions still apply."
    >
      <Notices error={notices.error} notice={notices.notice} />
      {rows.length ? (
        <table className="sf-table">
          <thead>
            <tr><th>Command</th><th>Allowed roles</th><th>State</th><th><span className="sr-only">Edit</span></th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.command}>
                <td className="sf-num">/{row.command.replace(/^\//, "")}</td>
                <td>{row.role_ids.join(", ") || "All roles"}</td>
                <td>{row.enabled ? "Enabled" : "Disabled"}</td>
                <td>
                  <button
                    className="sf-ghost"
                    disabled={disabled}
                    onClick={() => setDraft({ command: row.command, roles: row.role_ids.join(", "), enabled: row.enabled })}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title={loading ? "Loading restrictions…" : "No restrictions recorded"} detail={loading ? undefined : "This bot currently uses its defaults."} />
      )}
      <form
        className="sf-actions"
        onSubmit={(e) => {
          e.preventDefault();
          const role_ids = draft.roles.split(/[\s,]+/).filter(Boolean);
          if (role_ids.some((id) => !/^\d{15,21}$/.test(id))) {
            notices.run(async () => { throw new Error("Role IDs must contain 15–21 digits."); }, "");
            return;
          }
          void notices.run(
            () => mutate(`${base}/command-permissions`, { bot_key: botKey, command: draft.command, role_ids, enabled: draft.enabled }, "PUT"),
            "Command restriction saved.",
          );
        }}
      >
        <div className="sf-field"><span>Command</span><input required value={draft.command} disabled={disabled} placeholder="play" onChange={(e) => setDraft({ ...draft, command: e.target.value })} /></div>
        <div className="sf-field"><span>Allowed role IDs</span><input value={draft.roles} disabled={disabled} placeholder="123456789012345678" onChange={(e) => setDraft({ ...draft, roles: e.target.value })} /></div>
        <Check label="Command enabled" checked={draft.enabled} disabled={disabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
        <button className="sf-ghost" disabled={disabled}>Save restriction</button>
      </form>
    </Panel>
  );
}

export function ServerSettingsPanel({
  guildId,
  canOperate,
  scope = "all",
}: {
  guildId: string;
  canOperate: boolean;
  scope?: "all" | "server" | "notifications";
}) {
  const base = `/api/guilds/${encodeURIComponent(guildId)}`;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ settings: Settings }>(`${base}/settings`);
      setSettings(result.settings);
    } catch {
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  const notices = useNotices(load);
  const disabled = notices.busy || loading || !canOperate || !settings;
  return (
    <Panel
      title={scope === "notifications" ? "Notification preferences" : "Server settings"}
      detail="Saved to the selected server."
    >
      <Notices error={notices.error} notice={notices.notice} />
      {loading ? (
        <p className="sf-dim" role="status">Loading confirmed server state…</p>
      ) : !settings ? (
        <Empty title="Settings unavailable" detail="The API did not return settings for this server." />
      ) : (
        <>
          {scope !== "notifications" && (
            <Check
              label="Pause server (bots stop acting)"
              checked={settings.server_paused}
              disabled={disabled}
              onChange={(value) => void notices.run(() => mutate(`${base}/settings`, { server_paused: value }), "Server pause setting saved.")}
            />
          )}
          {scope !== "server" && (
            <>
              <Check
                label="Enable notifications"
                checked={settings.notifications_enabled}
                disabled={disabled}
                onChange={(value) => void notices.run(() => mutate(`${base}/settings`, { notifications_enabled: value }), "Notification setting saved.")}
              />
              <div className="sf-grid-2">
                {["security", "moderation", "fleet", "orders"].map((key) => (
                  <Check
                    key={key}
                    label={`${key} notifications`}
                    checked={settings.notification_preferences[key] ?? true}
                    disabled={disabled}
                    onChange={(value) =>
                      void notices.run(
                        () => mutate(`${base}/settings`, { notification_preferences: { ...settings.notification_preferences, [key]: value } }),
                        "Notification preferences saved.",
                      )
                    }
                  />
                ))}
              </div>
            </>
          )}
          {!canOperate && <p className="sf-dim">Read-only: full guild access is required to change settings.</p>}
        </>
      )}
    </Panel>
  );
}

export function ModuleConfig({ guildId, modules, canOperate }: { guildId: string; modules: string[]; canOperate: boolean }) {
  const base = `/api/guilds/${encodeURIComponent(guildId)}`;
  const [module, setModule] = useState(modules[0] ?? "");
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [config, setConfig] = useState<Configuration | null>(null);
  const [draft, setDraft] = useState<Record<string, ConfigValue>>({});
  const [history, setHistory] = useState<Configuration[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!modules.includes(module)) setModule(modules[0] ?? "");
  }, [modules, module]);
  const load = useCallback(async () => {
    if (!module) {
      setConfig(null);
      setFields([]);
      return;
    }
    setLoading(true);
    setHistory([]);
    try {
      const response = await api<{ configuration: Configuration; fields: ConfigField[] }>(
        `${base}/configuration/${encodeURIComponent(module)}`,
      );
      setConfig(response.configuration);
      setFields(response.fields);
      setDraft(response.configuration.value);
    } catch (cause) {
      setConfig(null);
      setFields([]);
      setErrorOnce(failText(cause));
    } finally {
      setLoading(false);
    }
  }, [base, module]);
  const [bootError, setErrorOnce] = useState("");
  useEffect(() => {
    setErrorOnce("");
    void load();
  }, [load]);
  const notices = useNotices(load);
  const disabled = notices.busy || loading || !canOperate || !config;
  const dirty = config ? JSON.stringify(draft) !== JSON.stringify(config.value) : false;
  // Unsaved-change handling: the save bar is the in-page signal; while a draft
  // differs from the saved version, a browser-level guard covers refresh/close.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  return (
    <Panel
      title="Module configuration"
      detail={`Server ${guildId} · saved settings are not the same as runtime-applied settings.`}
    >
      <Notices error={bootError || notices.error} notice={notices.notice} />
      {!modules.length ? (
        <Empty title="No configurable modules" detail="No bot assigned to this server exposes configuration yet." />
      ) : (
        <>
          <div className="sf-actions">
            <Field label="Module">
              <select value={module} onChange={(e) => setModule(e.target.value)} disabled={notices.busy}>
                {modules.map((id) => (
                  <option key={id} value={id}>{MODULE_LABELS[id] ?? id}</option>
                ))}
              </select>
            </Field>
            {config && (
              <span className="sf-dim">
                Version {config.version} ·{" "}
                {config.applied_at
                  ? `applied ${new Date(config.applied_at).toLocaleString()}`
                  : "saved settings have not been acknowledged by the runtime"}
              </span>
            )}
          </div>
          {loading ? (
            <p className="sf-dim" role="status">Loading module configuration…</p>
          ) : config ? (
            <>
              <div className="sf-grid-2">
                {fields.map((field) =>
                  field.type === "boolean" ? (
                    <Check
                      key={field.key}
                      label={field.label}
                      checked={Boolean(draft[field.key] ?? field.default)}
                      disabled={disabled}
                      onChange={(value) => setDraft({ ...draft, [field.key]: value })}
                    />
                  ) : (
                    <Field key={field.key} label={field.label}>
                      {field.type === "select" ? (
                        <select
                          disabled={disabled}
                          value={String(draft[field.key] ?? field.default ?? "")}
                          onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                        >
                          {field.options?.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : field.type === "textarea" ? (
                        <textarea
                          disabled={disabled}
                          value={String(draft[field.key] ?? field.default ?? "")}
                          onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                        />
                      ) : (
                        <input
                          disabled={disabled}
                          type={field.type === "number" ? "number" : "text"}
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          placeholder={field.placeholder}
                          value={String(draft[field.key] ?? field.default ?? "")}
                          onChange={(e) =>
                            setDraft({ ...draft, [field.key]: field.type === "number" ? Number(e.target.value) : e.target.value })
                          }
                        />
                      )}
                      {field.help && <small>{field.help}</small>}
                    </Field>
                  ),
                )}
              </div>
              {!fields.length && <p className="sf-dim">This module has no runtime configuration fields.</p>}
              {dirty && (
                <div className="sf-savebar" role="status">
                  <span className="sf-dim">Unsaved changes</span>
                  <button
                    className="sf-primary"
                    disabled={disabled}
                    onClick={() =>
                      void notices.run(
                        () =>
                          mutate(
                            `${base}/configuration/${encodeURIComponent(module)}`,
                            { expectedVersion: config.version, config: draft },
                            "PUT",
                          ),
                        "Configuration saved. Runtime application is reported separately.",
                      )
                    }
                  >
                    Save configuration
                  </button>
                  <button className="sf-ghost" disabled={notices.busy} onClick={() => setDraft(config.value)}>
                    Discard
                  </button>
                  <button
                    className="sf-ghost"
                    disabled={notices.busy}
                    onClick={() => setDraft(Object.fromEntries(fields.map((f) => [f.key, f.default ?? ""])))}
                  >
                    Draft defaults
                  </button>
                </div>
              )}
              <div className="sf-actions">
                <button
                  className="sf-ghost"
                  disabled={notices.busy}
                  onClick={() =>
                    void notices.run(async () => {
                      const response = await api<{ history: Configuration[] }>(
                        `${base}/configuration/${encodeURIComponent(module)}/history`,
                      );
                      setHistory(response.history.map((entry) => ({ ...entry, updated_at: entry.updated_at ?? entry.changed_at })));
                    }, "Configuration history loaded.")
                  }
                >
                  View history
                </button>
              </div>
              {!!history.length && (
                <div>
                  <h3>Saved versions</h3>
                  {history.map((entry, index) => (
                    <p key={entry.version ?? index} className="sf-dim">
                      Version {entry.version} ·{" "}
                      {entry.updated_at ? new Date(entry.updated_at).toLocaleString() : "Timestamp unavailable"} ·{" "}
                      {entry.applied_at ? "Runtime acknowledged" : "Awaiting runtime acknowledgement"}
                    </p>
                  ))}
                </div>
              )}
              {!canOperate && <p className="sf-dim">Read-only: a grant for this module is required to change configuration.</p>}
            </>
          ) : (
            <Empty title="No saved configuration" detail="This module has not been configured for the server yet." />
          )}
        </>
      )}
    </Panel>
  );
}

export function JobsPanel({ guildId, title = "Delivery history", refreshKey = 0 }: { guildId: string; title?: string; refreshKey?: number }) {
  const base = `/api/guilds/${encodeURIComponent(guildId)}`;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ jobs: Job[] }>(`${base}/embeds`);
      setJobs(result.jobs);
    } catch (cause) {
      setJobs([]);
      setError(failText(cause));
    } finally {
      setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  return (
    <Panel title={title} detail="Queue acknowledgement means accepted for delivery; it is not proof of a Discord send.">
      {error && <p className="sf-note sf-error" role="alert">{error}</p>}
      {jobs.length ? (
        <table className="sf-table">
          <thead><tr><th>Job</th><th>Kind</th><th>Status</th></tr></thead>
          <tbody>
            {jobs.map((job, index) => (
              <tr key={job.job_id ?? job.id ?? index}>
                <td className="sf-num">{job.job_id ?? job.id ?? "—"}</td>
                <td>{job.kind ?? "embed"}</td>
                <td>{job.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title={loading ? "Loading delivery history…" : "No queued deliveries"} />
      )}
    </Panel>
  );
}
