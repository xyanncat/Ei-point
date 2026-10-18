"use client";
// Moderation · Incidents: security events recorded for this server.
import { useOverview } from "../../../components/staff/use-overview";
import { Empty, PageHeader, Panel, HealthBadge, stamp } from "../../../components/staff/ui";

export default function ModerationIncidentsPage() {
  const { data, busy, error, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const allowed = scopes.some((s) => s === "*" || s === "security" || s === "moderation");

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
        ) : data?.incidents.length ? (
          <table className="sf-table">
            <thead>
              <tr><th>Event</th><th>Severity</th><th>Recorded</th></tr>
            </thead>
            <tbody>
              {data.incidents.map((incident) => (
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
          <Empty
            title={busy ? "Loading incidents…" : "No recent incidents"}
            detail={busy ? undefined : "No security events have been recorded for this server."}
          />
        )}
      </Panel>
    </>
  );
}
