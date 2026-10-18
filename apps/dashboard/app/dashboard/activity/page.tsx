"use client";
// Activity · Audit trail: who changed what, newest first.
import { useOverview } from "../../../components/staff/use-overview";
import { Empty, PageHeader, Panel, stamp } from "../../../components/staff/ui";

export default function ActivityAuditPage() {
  const { data, busy, refresh } = useOverview();
  const actions = data?.actions ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Activity"
        title="Audit trail"
        explain="Recorded configuration changes for the selected server."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <Panel title="Recent changes" detail="A saved version is not yet a confirmed change; runtime acknowledgement is reported per module.">
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
    </>
  );
}
