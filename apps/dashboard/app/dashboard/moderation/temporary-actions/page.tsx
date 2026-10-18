"use client";
// Moderation · Temporary actions: expirations, cleanup outcomes and retries.
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function ModerationTemporaryActionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Moderation"
        title="Temporary actions"
        explain="Mutes, timeouts and their expiry or cleanup outcome."
      />
      <Panel title="Not connected yet" detail="Temporary actions are published by the security modules.">
        <Empty
          title="No active temporary actions"
          detail="Once the modules publish them, active actions appear here with expiry countdowns, failed cleanup and retry status."
        />
      </Panel>
    </>
  );
}
