"use client";
// Moderation: security events recorded for this server. Cases, protection
// rules and temporary actions land here as the security modules publish them.
import { useOverview } from "../../../components/staff/use-overview";
import { Empty, PageHeader, Panel, HealthBadge, stamp } from "../../../components/staff/ui";

export default function ModerationPage() {
  const { data, busy, error, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const allowed = scopes.some((s) => s === "*" || s === "security" || s === "moderation");

  return (
    <>
      <PageHeader
        eyebrow="Staff workspace"
        title="Moderation"
        explain="Recent security events for this server, with cases and temporary actions as the modules report them."
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
      <Panel title="Incidents" detail="Counts mean the latest recorded events, not unresolved cases.">
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
      <Panel title="Will live here" detail="Marked honestly so nothing pretends to work before its module ships.">
        <ul className="sf-list">
          <li><span className="sf-dot" />Cases with evidence and sanctions</li>
          <li><span className="sf-dot" />Protection rules (antinuke, raid, AutoMod)</li>
          <li><span className="sf-dot" />Temporary actions with expiry and retry status</li>
        </ul>
      </Panel>
    </>
  );
}
