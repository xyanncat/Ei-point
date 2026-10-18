"use client";
// Moderation · Cases: reserved destination. No case storage exists yet — the
// page says so explicitly instead of showing a fake empty list.
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function ModerationCasesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Moderation"
        title="Cases"
        explain="Investigations with evidence, actors and sanctions."
      />
      <Panel title="Not connected yet" detail="Case storage ships with the security module rollout.">
        <Empty
          title="No case system is connected"
          detail="When the security modules publish cases, they appear here with their evidence, sanctions and status."
        />
      </Panel>
    </>
  );
}
