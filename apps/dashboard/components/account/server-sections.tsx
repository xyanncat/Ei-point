"use client";
// Per-server workspace: each server is its own block with grouped sub-pages.
//
//   GENERAL      Overview · Settings · Messages
//   MANAGEMENT   Reaction roles · Auto roles · Welcome & Leave · Event Reminder
//   TICKET       Ticket · Logs
//   MODERATION   Automod · Raid protection · Moderation · Logs · Lockdown
//
// Every section backed by a real endpoint renders live controls. Sections
// with no backend (no tables, no API, no bot runtime) say so plainly instead
// of faking controls.
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { api, ApiError } from "../../lib/api";
import { Empty, HealthBadge, Panel, stateText } from "../staff/ui";
import { botsMeta } from "../staff/bots-meta";
import {
  BotStatePanel,
  CommandPermissionsPanel,
  ModuleConfig,
  ServerSettingsPanel,
  JobsPanel,
} from "../staff/panels";
import { StaffAccessPanel } from "../staff/staff-access";
import { MasterServerControls } from "./master-controls";

export const SECTION_GROUPS: { label: string; items: { id: string; label: string }[] }[] = [
  {
    label: "General",
    items: [
      { id: "overview", label: "Overview" },
      { id: "settings", label: "Settings" },
      { id: "messages", label: "Messages" },
    ],
  },
  {
    label: "Management",
    items: [
      { id: "reaction-roles", label: "Reaction roles" },
      { id: "auto-roles", label: "Auto roles" },
      { id: "welcome", label: "Welcome & Leave" },
      { id: "event-reminder", label: "Event Reminder" },
    ],
  },
  {
    label: "Ticket system",
    items: [
      { id: "ticket", label: "Ticket" },
      { id: "ticket-logs", label: "Logs" },
    ],
  },
  {
    label: "Moderation",
    items: [
      { id: "automod", label: "Automod" },
      { id: "raid", label: "Raid protection" },
      { id: "moderation", label: "Moderation" },
      { id: "mod-logs", label: "Logs" },
      { id: "lockdown", label: "Lockdown" },
    ],
  },
];

export const SECTION_IDS = SECTION_GROUPS.flatMap((group) => group.items.map((item) => item.id));

const GAPS: Record<string, string> = {
  "reaction-roles":
    "Reaction-role menus are not connected yet. There is no table, endpoint or bot runtime behind this tab, so it stays empty rather than faking controls.",
  "auto-roles":
    "Automatic roles on join are not connected yet. There is no table, endpoint or bot runtime behind this tab, so it stays empty rather than faking controls.",
  "event-reminder":
    "Scheduled event reminders are not connected yet. There is no table, endpoint or bot runtime behind this tab, so it stays empty rather than faking controls.",
  ticket:
    "The ticket panel is not connected yet. There is no table, endpoint or bot runtime behind this tab, so it stays empty rather than faking controls.",
  "ticket-logs":
    "Ticket transcripts are not connected yet. There is no table or endpoint behind this tab, so it stays empty rather than faking a history.",
};

async function mutate<T>(path: string, body: unknown, method = "POST") {
  const { csrfToken } = await api<{ csrfToken: string }>("/api/auth/csrf");
  return api<T>(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
}

function Gap({ title }: { title: string }) {
  return (
    <Panel title={title} detail="Planned section.">
      <Empty title="Not connected yet" detail={GAPS[title] ?? "This section has no backend behind it yet."} />
    </Panel>
  );
}

/** Renders a module editor only when a bot in this server carries the module. */
function ModuleGate({
  guildId,
  carried,
  modules,
  title,
  detail,
  canOperate,
}: {
  guildId: string;
  carried: string[];
  modules: string[];
  title: string;
  detail: string;
  canOperate: boolean;
}) {
  const available = modules.filter((m) => carried.includes(m));
  if (!available.length) {
    return (
      <Panel title={title} detail={detail}>
        <Empty
          title="No bot carries this module here"
          detail="None of the bots in this server exposes these settings yet. Add the module to a bot in the registry to configure it."
        />
      </Panel>
    );
  }
  return <ModuleConfig guildId={guildId} modules={available} canOperate={canOperate} />;
}

type EmbedJob = {
  job_id: string;
  status: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  channel_id: string;
};

/** Messages: compose a Discord embed and queue it through a bot in this server. */
function MessageSender({
  guildId,
  bots,
  canOperate,
}: {
  guildId: string;
  bots: { key: string; name: string }[];
  canOperate: boolean;
}) {
  const [bot, setBot] = useState("");
  const activeBot = bot || bots[0]?.key || "";
  const [channel, setChannel] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [jobs, setJobs] = useState<EmbedJob[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ jobs: EmbedJob[] }>(
        `/api/guilds/${encodeURIComponent(guildId)}/embeds`,
      );
      setJobs(result.jobs);
    } catch {
      setJobs([]);
    }
  }, [guildId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await mutate<{ queued: boolean; job_id: string }>(
        `/api/guilds/${encodeURIComponent(guildId)}/embeds`,
        { bot_id: activeBot, channel_id: channel.trim(), title: title.trim(), description: body.trim() },
      );
      if (!result.queued) throw new Error("The message was not queued.");
      setNotice("Message queued for delivery.");
      setTitle("");
      setBody("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The message could not be queued.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Messages"
      detail="Send an embed to a channel through a bot in this server. Channel IDs are Discord snowflakes."
    >
      {error ? (
        <p className="sf-note sf-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="world-note world-note--ok" role="status">
          {notice}
        </p>
      ) : null}
      {!canOperate ? (
        <p className="sf-dim">Read-only: full guild access is required to send messages.</p>
      ) : null}
      <form
        className="sf-actions"
        onSubmit={(event) => void send(event)}
      >
        <label className="sf-field">
          <span>Bot</span>
          <select value={activeBot} onChange={(event) => setBot(event.target.value)} disabled={busy || !canOperate}>
            {bots.map((b) => (
              <option key={b.key} value={b.key}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sf-field">
          <span>Channel ID</span>
          <input
            required
            inputMode="numeric"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            disabled={busy || !canOperate}
            placeholder="123456789012345678"
          />
        </label>
        <label className="sf-field">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy || !canOperate} />
        </label>
        <label className="sf-field">
          <span>Message</span>
          <textarea rows={4} required value={body} onChange={(event) => setBody(event.target.value)} disabled={busy || !canOperate} />
        </label>
        <button className="sf-ghost" type="submit" disabled={busy || !canOperate}>
          {busy ? "Queueing…" : "Send message"}
        </button>
      </form>
      <h3 className="sf-card__title" style={{ marginTop: "0.6rem" }}>
        Recently queued
      </h3>
      {jobs.length ? (
        <table className="sf-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Channel</th>
              <th>Queued</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.job_id}>
                <td>
                  <HealthBadge
                    health={job.status === "done" ? "ok" : job.status === "failed" ? "down" : "degraded"}
                    text={job.status}
                  />
                </td>
                <td className="sf-num">{job.channel_id}</td>
                <td className="sf-num">{new Date(job.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title="Nothing queued yet" detail="Messages sent from this tab appear here with their delivery status." />
      )}
    </Panel>
  );
}

type Incident = { id: string; kind: string; severity: string; createdAt: string };
type ChangeAction = { id: string; key: string; version: number; changedAt: string };

/** Moderation: live incidents plus the recent configuration history. */
function ModerationView({ incidents, actions }: { incidents: Incident[]; actions: ChangeAction[] }) {
  return (
    <>
      <Panel title="Incidents" detail="What the protection runtime has flagged in this server.">
        {incidents.length ? (
          <table className="sf-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Severity</th>
                <th>Flagged</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td>{incident.kind}</td>
                  <td>
                    <HealthBadge
                      health={incident.severity === "high" ? "down" : incident.severity === "medium" ? "degraded" : "unknown"}
                      text={incident.severity}
                    />
                  </td>
                  <td className="sf-num">{new Date(incident.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No incidents" detail="Nothing flagged in this server." />
        )}
      </Panel>
      <div style={{ marginTop: "1.2rem" }}>
        <Panel title="Recent changes" detail="The latest configuration saves for this server.">
          {actions.length ? (
            <table className="sf-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Version</th>
                  <th>Changed</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action.id}>
                    <td className="sf-num">{action.key}</td>
                    <td className="sf-num">v{action.version}</td>
                    <td className="sf-num">{new Date(action.changedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No changes yet" detail="Configuration saves appear here." />
          )}
        </Panel>
      </div>
    </>
  );
}

type AuditEntry = { id: string; actor_id: string; action: string; target: string; created_at: string };

/** Lockdown: the raid and lockdown slice of the control audit plus incidents. */
function LockdownView({ guildId, incidents }: { guildId: string; incidents: Incident[] }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<{ logs: { logs: AuditEntry[] } }>(`/api/guilds/${encodeURIComponent(guildId)}/logs`)
      .then((result) => {
        if (alive) setEntries(result.logs.logs.filter((e) => /lock|raid/i.test(e.action)));
      })
      .catch(() => {
        if (alive) setEntries([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [guildId]);

  const raidIncidents = incidents.filter((i) => /raid|lock/i.test(`${i.kind} ${i.severity}`));
  return (
    <Panel
      title="Lockdown"
      detail="Raid and lockdown events in this server. The switches live under Raid protection."
    >
      {loading ? (
        <p className="sf-dim" role="status">
          Loading lockdown events…
        </p>
      ) : entries.length || raidIncidents.length ? (
        <>
          {raidIncidents.length ? (
            <table className="sf-table">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Severity</th>
                  <th>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {raidIncidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>{incident.kind}</td>
                    <td>
                      <HealthBadge
                        health={incident.severity === "high" ? "down" : "degraded"}
                        text={incident.severity}
                      />
                    </td>
                    <td className="sf-num">{new Date(incident.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {entries.length ? (
            <table className="sf-table" style={{ marginTop: raidIncidents.length ? "1rem" : undefined }}>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="sf-num">{entry.action}</td>
                    <td className="sf-num">{entry.target}</td>
                    <td className="sf-num">{new Date(entry.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : (
        <Empty title="No lockdown events" detail="No raid or lockdown activity is recorded for this server." />
      )}
    </Panel>
  );
}

export function SectionNav({
  section,
  onSelect,
}: {
  section: string;
  onSelect: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="sf-sections">
      {SECTION_GROUPS.map((group) => (
        <div key={group.label} className="sf-section-group">
          <p className="sf-section-label">{group.label}</p>
          <div className="world-tabs" role="group" aria-label={group.label}>
            {group.items.map((item) => {
              const selected = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="world-tab"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  {selected && !reduce ? (
                    <motion.span
                      layoutId="section-active"
                      className="world-tab__pill"
                      aria-hidden="true"
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    />
                  ) : null}
                  <span className="world-tab__label">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

type BotCard = {
  botKey: string;
  modules?: string[];
  state: string;
  stale?: boolean;
  updatedAt?: string | null;
};

type OverviewData = {
  cards: BotCard[];
  incidents: Incident[];
  actions: ChangeAction[];
};

function validSection(value: string | null): string {
  return value && SECTION_IDS.includes(value) ? value : "overview";
}

function syncSectionParam(id: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("section", id);
  window.history.replaceState(null, "", url.toString());
}

/** One server's full workspace: section tabs plus the active section. */
export function ServerWorkspace({
  guildId,
  guildName,
  role,
  isAdmin,
  isMaster,
  data,
  canOperate,
}: {
  guildId: string;
  guildName: string;
  role: string;
  isAdmin: boolean;
  isMaster: boolean;
  data: OverviewData | null;
  canOperate: boolean;
}) {
  const [openBot, setOpenBot] = useState("");
  const [section, setSection] = useState<string>(() =>
    typeof window === "undefined"
      ? "overview"
      : validSection(new URLSearchParams(window.location.search).get("section")),
  );
  const cards = data?.cards ?? [];
  const incidents = data?.incidents ?? [];
  const actions = data?.actions ?? [];
  const carried = [...new Set(cards.flatMap((card) => card.modules ?? []))];
  const bots = cards.map((card) => ({ key: card.botKey, name: botsMeta(card.botKey).name }));

  function selectSection(id: string) {
    setSection(id);
    syncSectionParam(id);
  }

  return (
    <>
      <SectionNav section={section} onSelect={selectSection} />
      <section aria-label={`${guildName || "Server"} workspace`}>
        {section === "overview" ? (
          <OverviewSection
            guildId={guildId}
            guildName={guildName}
            cards={cards}
            canOperate={canOperate}
            isAdmin={isAdmin}
            isMaster={isMaster}
            openBot={openBot}
            setOpenBot={setOpenBot}
          />
        ) : null}
        {section === "settings" ? (
          <>
            {(canOperate || isMaster) && (
              <ServerSettingsPanel guildId={guildId} canOperate={canOperate} />
            )}
            {(isAdmin || isMaster) && (
              <div style={{ marginTop: "1.2rem" }}>
                <StaffAccessPanel guildId={guildId} />
              </div>
            )}
            {isMaster && (
              <div style={{ marginTop: "1.2rem" }}>
                <MasterServerControls guildId={guildId} guildName={guildName} />
              </div>
            )}
            {!canOperate && !isMaster && (
              <Panel title="Settings" detail="Saved to this server.">
                <p className="sf-dim">Read-only: full guild access is required to change settings.</p>
              </Panel>
            )}
          </>
        ) : null}
        {section === "messages" ? (
          <MessageSender guildId={guildId} bots={bots} canOperate={canOperate} />
        ) : null}
        {section === "welcome" ? (
          <ModuleGate
            guildId={guildId}
            carried={carried}
            modules={["welcome", "community"]}
            title="Welcome & Leave"
            detail="Greetings, farewells and level-up notes for this server."
            canOperate={canOperate}
          />
        ) : null}
        {section === "automod" ? (
          <ModuleGate
            guildId={guildId}
            carried={carried}
            modules={["moderation"]}
            title="Automod"
            detail="Automatic filtering and warnings for this server."
            canOperate={canOperate}
          />
        ) : null}
        {section === "raid" ? (
          <ModuleGate
            guildId={guildId}
            carried={carried}
            modules={["security"]}
            title="Raid protection"
            detail="Thresholds, punishments and raid lockdown for this server."
            canOperate={canOperate}
          />
        ) : null}
        {section === "moderation" ? (
          <ModerationView incidents={incidents} actions={actions} />
        ) : null}
        {section === "mod-logs" ? (
          <>
            <ModuleGate
              guildId={guildId}
              carried={carried}
              modules={["logging"]}
              title="Logging"
              detail="Which events the bots record for this server."
              canOperate={canOperate}
            />
            <div style={{ marginTop: "1.2rem" }}>
              <JobsPanel guildId={guildId} />
            </div>
          </>
        ) : null}
        {section === "lockdown" ? (
          <LockdownView guildId={guildId} incidents={incidents} />
        ) : null}
        {GAPS[section] ? <Gap title={section} /> : null}
      </section>
      <p className="world-note" style={{ marginTop: "1.2rem" }}>
        Signed in with {role} access to {guildName || "this server"}.{" "}
        {isMaster
          ? "As the master account you see every approved server and no bot can refuse your commands."
          : "Everything here applies to this server only."}
      </p>
    </>
  );
}

function OverviewSection({
  guildId,
  guildName,
  cards,
  canOperate,
  isAdmin,
  isMaster,
  openBot,
  setOpenBot,
}: {
  guildId: string;
  guildName: string;
  cards: BotCard[];
  canOperate: boolean;
  isAdmin: boolean;
  isMaster: boolean;
  openBot: string;
  setOpenBot: (key: string) => void;
}) {
  return (
    <>
      <Panel
        title={`Bots in ${guildName || "this server"}`}
        detail="Open a bot to configure it. Everything here applies to this server only."
      >
        {cards.length ? (
          <div className="sf-cards">
            {cards.map((card) => {
              const meta = botsMeta(card.botKey);
              const isOpen = openBot === card.botKey;
              return (
                <article key={card.botKey} className="sf-card">
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
                    <span className="sf-num">
                      Seen{" "}
                      {card.updatedAt
                        ? new Date(card.updatedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                        : "never"}
                    </span>
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
              );
            })}
          </div>
        ) : (
          <Empty
            title="No bots in this server"
            detail="Add this server to the bot registry to see its services here."
          />
        )}
      </Panel>
      {openBot ? (
        <div className="world-stack" style={{ marginTop: "1.2rem" }}>
          <BotStatePanel guildId={guildId} botKey={openBot} canOperate={canOperate} />
          <ModuleConfig
            guildId={guildId}
            modules={cards.find((card) => card.botKey === openBot)?.modules ?? []}
            canOperate={canOperate}
          />
          <CommandPermissionsPanel guildId={guildId} botKey={openBot} canOperate={canOperate} />
          {isAdmin || isMaster ? <StaffAccessPanel guildId={guildId} /> : null}
        </div>
      ) : null}
    </>
  );
}
