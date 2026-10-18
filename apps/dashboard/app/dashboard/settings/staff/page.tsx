"use client";
// Settings · Staff access: role-scoped grants for the selected server.
// Moved out of System so global administration and per-server access do not
// share one page (owner task 2026-10-19).
import { useStaff } from "../../../../components/staff/staff-context";
import { StaffAccessPanel } from "../../../../components/staff/staff-access";
import { PageHeader } from "../../../../components/staff/ui";

export default function SettingsStaffPage() {
  const { guild } = useStaff();

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Staff access"
        explain="Give Discord roles scoped access without making them owners."
      />
      <StaffAccessPanel guildId={guild} />
    </>
  );
}
