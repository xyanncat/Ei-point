"use client";
// Moderation · Incidents: security events for this server, filterable by text
// and severity (record-list pattern).
import { useState } from "react";
import { useOverview } from "../../../components/staff/use-overview";
import { Empty, PageHeader, Panel, HealthBadge, stamp } from "../../../components/staff/ui";

export default function ModerationIncidentsPage() {
  const { data, busy, error, refresh } = useOverview();
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const scopes = data?.guild.scopes ?? [];
  const allowed = scopes.some((s) => s === "*" || s === "security" || s === "moderation");
  const all = data?.incidents ?? [];
  const incidents = all.filter(
    (incident) =>
      (severity === "all" || incident.severity === severity) &&
      `${incident.kind} ${incident.severity}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        eyebrow="Moderation"
        title="Incidents"
        explain="Security events recorded for this server."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      {error && (
        <div className="sf-note sf-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <Panel title="Recorded events" detail="Counts mean the latest recorded events, not unresolved cases.">
        {!allowed ? (
          <Empty title="No access" detail="Your staff role does not include security events." />
        ) : all.length ? (
          <>
            <div className="sf-actions">
              <label className="sf-field">
                <span>Find an event</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Raid, flood…"
                />
              </label>
              <label className="sf-field">
                <span>Severity</span>
                <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                  <option value="all">All severities</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
            </div>
            {incidents.length ? (
              <table className="sf-table">
                <thead>
                  <tr><th>Event</th><th>Severity</th><th>Recorded</th></tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr key={incident.id}>
                      <td>{incident.kind.replaceAll("-", " ")}</td>
                      <td>
                        <HealthBadge
                          health={incident.severity === "high" ? "down" : incident.severity === "medium" ? "degraded" : "ok"}
                          text={incident.severity}
                        />
                      </td>
                      <td className="sf-num">{stamp(incident.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No incidents match the filter" detail="Clear the search or choose another severity." />
            )}
          </>
        ) : (
          <Empty
            title={busy ? "Loading incidents…" : "No recent incidents"}
            detail={busy ? undefined : "No security events have been recorded for this server."}
          />
        )}
      </Panel>
    </>
  );
}
