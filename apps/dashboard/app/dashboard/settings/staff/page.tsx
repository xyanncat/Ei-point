"use client";
// Settings · Staff access: role-scoped grants for the selected server.
// Admin-gated page; the admin API is the real authorization boundary.
import { useStaff } from "../../../../components/staff/staff-context";
import { StaffAccessPanel } from "../../../../components/staff/staff-access";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

export default function SettingsStaffPage() {
  const { guild, isAdmin } = useStaff();

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Staff access"
        explain="Give Discord roles scoped access without making them owners."
      />
      {isAdmin ? (
        <StaffAccessPanel guildId={guild} />
      ) : (
        <Panel title="Owner/admin only">
          <Empty title="No access" detail="Managing role grants requires an admin scope." />
        </Panel>
      )}
    </>
  );
}
