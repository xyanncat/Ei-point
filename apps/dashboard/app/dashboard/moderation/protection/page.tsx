"use client";
// Moderation · Protection rules: configuration for the security, moderation
// and audit-logging modules (one home per module, owner task 2026-10-19).
import { useOverview } from "../../../../components/staff/use-overview";
import { useStaff } from "../../../../components/staff/staff-context";
import { ModuleConfig } from "../../../../components/staff/panels";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

const PROTECTION_MODULES = ["security", "moderation", "logging"];

export default function ModerationProtectionPage() {
  const { guild } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const canOperate = scopes.includes("*");
  const assigned = [...new Set((data?.cards ?? []).flatMap((c) => c.modules ?? []))];
  const modules = assigned.filter((m) => PROTECTION_MODULES.includes(m));

  return (
    <>
      <PageHeader
        eyebrow="Moderation"
        title="Protection rules"
        explain="Automod, raid thresholds and audit logging for the selected server."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <ModuleConfig guildId={guild} modules={modules} canOperate={canOperate} />
      <Panel title="Temporary actions" detail="Mutes and timeouts issued by the modules.">
        <Empty
          title="Not connected yet"
          detail="Temporary actions with expiry and retry status appear here once the security modules publish them."
        />
      </Panel>
    </>
  );
}
