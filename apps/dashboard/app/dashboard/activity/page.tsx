"use client";
// Activity: audit trail (configuration changes) and delivery/job history.
import { useOverview } from "../../../components/staff/use-overview";
import { useStaff } from "../../../components/staff/staff-context";
import { JobsPanel } from "../../../components/staff/panels";
import { Empty, PageHeader, Panel, stamp } from "../../../components/staff/ui";

export default function ActivityPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const actions = data?.actions ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Staff workspace"
        title="Activity"
        explain="Who changed what, and what the delivery queue did with it."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <Panel title="Audit trail" detail="Recorded configuration changes for this server. A saved version is not yet a confirmed change.">
        {actions.length ? (
          <ul className="sf-list">
            {actions.map((action) => (
              <li key={action.id}>
                <span className="sf-dot" />
                <div>
                  <strong>{action.key}</strong> <span className="sf-dim">saved version {action.version}</span>
                </div>
                <time dateTime={action.changedAt}>{stamp(action.changedAt)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title={busy ? "Loading activity…" : "A quiet workspace"} detail="Configuration changes will appear here when recorded." />
        )}
      </Panel>
      <JobsPanel guildId={guild} />
    </>
  );
}
