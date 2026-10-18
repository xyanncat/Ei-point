"use client";
// Settings: server settings, notifications, module configuration. The old
// "Configuration" and "Fleet controls" destinations moved here and into
// the sections (owner brief: one permanent home per function).
import Link from "next/link";
import { useOverview } from "../../../components/staff/use-overview";
import { useStaff } from "../../../components/staff/staff-context";
import { ModuleConfig, ServerSettingsPanel } from "../../../components/staff/panels";
import { PageHeader, Panel } from "../../../components/staff/ui";

export default function SettingsPage() {
  const { guild, isAdmin } = useStaff();
  const { data, busy, refresh } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  const canOperate = scopes.includes("*");
  const modules = [...new Set((data?.cards ?? []).flatMap((c) => c.modules ?? []))];

  return (
    <>
      <PageHeader
        eyebrow="Staff workspace"
        title="Settings"
        explain="Server-wide preferences, module configuration and staff access."
        actions={
          <button className="sf-ghost" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <ServerSettingsPanel guildId={guild} canOperate={canOperate} />
      <ModuleConfig guildId={guild} modules={modules} canOperate={canOperate} />
      <Panel title="Staff access" detail="Role-scoped grants for people who are not owners or managers.">
        <p className="sf-dim">
          {isAdmin
            ? "You hold an admin scope — grants live in System, kept apart from the selected server so a wrong click can never change the wrong guild."
            : "Ask an owner or admin to grant a role scope if you need access to another section."}
        </p>
        {isAdmin && <p><Link className="sf-ghost" href="/dashboard/system">Open System</Link></p>}
      </Panel>
    </>
  );
}
