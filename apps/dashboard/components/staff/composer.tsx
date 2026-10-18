"use client";
// Announcement composer (composer pattern): editor left, live draft preview
// right, delivery result below. Moved here from the old Fleet controls.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { JobsPanel } from "./panels";
import { Empty, Panel } from "./ui";

type Job = { job_id?: string; id?: string; status: string };
type Bot = { bot_key: string; modules: string[] };

export function AnnouncementComposer({ guildId, canOperate }: { guildId: string; canOperate: boolean }) {
  const base = `/api/guilds/${encodeURIComponent(guildId)}`;
  const [bots, setBots] = useState<Bot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [composer, setComposer] = useState({ bot_id: "", channel_id: "", title: "", description: "", color: "#bf6b94", url: "", image: "", thumbnail: "", footer: "", authorName: "", authorUrl: "", authorIcon: "" });
  const [fields, setFields] = useState<{ name: string; value: string; inline: boolean }[]>([]);
  const [buttons, setButtons] = useState<{ label: string; url: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await api<{ bots: Bot[] }>(`${base}/bot-state`);
      setBots(result.bots);
    } catch {
      setBots([]);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const disabled = busy || !canOperate;
  const input = (key: keyof typeof composer, label: string, required = false) => (
    <label className="sf-field" key={key}>
      <span>{label}</span>
      <input
        required={required}
        maxLength={key === "title" ? 256 : 2048}
        disabled={disabled}
        value={composer[key]}
        onChange={(e) => setComposer({ ...composer, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <Panel
      title="Compose an announcement"
      detail="Compose an embed, check the draft preview, then queue it for the sending bot. Queue acknowledgement is not proof of delivery."
    >
      {error && <p className="sf-note sf-error" role="alert">{error}</p>}
      {notice && <p className="sf-note sf-ok-note sf-checkmark" role="status">{notice}</p>}
      <div className="sf-grid-2">
        <form
          style={{ display: "grid", gap: "0.8rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            void (async () => {
              try {
                const { authorName, authorUrl, authorIcon, ...payload } = composer;
                const { csrfToken } = await api<{ csrfToken: string }>("/api/auth/csrf");
                const result = await api<{ queued: boolean; job_id: string; status: string }>(`${base}/embeds`, {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
                  body: JSON.stringify({ ...payload, fields, buttons, author: { name: authorName, url: authorUrl, iconUrl: authorIcon } }),
                });
                if (!result.queued || !result.job_id) throw new Error("No durable queue acknowledgement received.");
                setNotice("Embed accepted by the durable delivery queue. See delivery history below.");
              } catch (cause) {
                setError(cause instanceof ApiError && cause.status === 403 ? `Access denied: ${cause.message}` : cause instanceof Error ? cause.message : "Queue failed.");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <label className="sf-field">
            <span>Sending bot</span>
            <select required disabled={disabled} value={composer.bot_id} onChange={(e) => setComposer({ ...composer, bot_id: e.target.value })}>
              <option value="">Choose registered bot</option>
              {bots.map((b) => (
                <option key={b.bot_key}>{b.bot_key}</option>
              ))}
            </select>
          </label>
          {input("channel_id", "Channel ID", true)}
          {input("title", "Title")}
          <label className="sf-field">
            <span>Description</span>
            <textarea maxLength={4096} disabled={disabled} value={composer.description} onChange={(e) => setComposer({ ...composer, description: e.target.value })} />
          </label>
          <div className="sf-grid-2">
            {input("color", "Accent color")}
            {input("url", "Title URL")}
            {input("image", "Image URL")}
            {input("thumbnail", "Thumbnail URL")}
            {input("authorName", "Author name")}
            {input("authorUrl", "Author URL")}
            {input("authorIcon", "Author icon URL")}
            {input("footer", "Footer")}
          </div>
          {fields.map((field, index) => (
            <div className="sf-actions" key={index}>
              <label className="sf-field"><span>Field {index + 1} name</span>
                <input required maxLength={256} value={field.name} onChange={(e) => setFields(fields.map((f, i) => (i === index ? { ...f, name: e.target.value } : f)))} />
              </label>
              <label className="sf-field"><span>Field {index + 1} value</span>
                <input required maxLength={1024} value={field.value} onChange={(e) => setFields(fields.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)))} />
              </label>
              <label className="sf-check">
                <input type="checkbox" checked={field.inline} onChange={(e) => setFields(fields.map((f, i) => (i === index ? { ...f, inline: e.target.checked } : f)))} />
                Inline
              </label>
              <button type="button" className="sf-ghost" onClick={() => setFields(fields.filter((_, i) => i !== index))}>Remove field {index + 1}</button>
            </div>
          ))}
          {buttons.map((button, index) => (
            <div className="sf-actions" key={index}>
              <label className="sf-field"><span>Button {index + 1} label</span>
                <input required maxLength={80} value={button.label} onChange={(e) => setButtons(buttons.map((b, i) => (i === index ? { ...b, label: e.target.value } : b)))} />
              </label>
              <label className="sf-field"><span>Button {index + 1} URL</span>
                <input required type="url" value={button.url} onChange={(e) => setButtons(buttons.map((b, i) => (i === index ? { ...b, url: e.target.value } : b)))} />
              </label>
              <button type="button" className="sf-ghost" onClick={() => setButtons(buttons.filter((_, i) => i !== index))}>Remove button {index + 1}</button>
            </div>
          ))}
          <div className="sf-actions">
            <button type="button" className="sf-ghost" disabled={disabled || fields.length >= 25} onClick={() => setFields([...fields, { name: "", value: "", inline: false }])}>Add field</button>
            <button type="button" className="sf-ghost" disabled={disabled || buttons.length >= 5} onClick={() => setButtons([...buttons, { label: "", url: "" }])}>Add link button</button>
            <button className="sf-primary" disabled={disabled}>Queue embed</button>
          </div>
        </form>
        <div className="sf-panel" style={{ borderLeft: `3px solid ${composer.color}` }} aria-label="Draft preview">
          <small className="sf-dim">Draft preview</small>
          {composer.authorName && <p className="sf-dim">{composer.authorName}</p>}
          <h3 style={{ margin: 0 }}>{composer.title || "Untitled embed"}</h3>
          <p>{composer.description || "Description preview"}</p>
          <div className="sf-grid-2">
            {fields.map((f, i) => (
              <div key={i}><strong>{f.name}</strong><p className="sf-dim">{f.value}</p></div>
            ))}
          </div>
          {composer.footer && <small className="sf-dim">{composer.footer}</small>}
          {buttons.map((b, i) => (
            <span key={i} className="sf-badge">{b.label || "Link button"}</span>
          ))}
        </div>
      </div>
      {!canOperate && <p className="sf-dim">Read-only: full guild access is required to queue announcements.</p>}
      {!bots.length && <Empty title="No registered bots" detail="Announcements need a registered sending bot for this server." />}
      <JobsPanel guildId={guildId} />
    </Panel>
  );
}
