import type { ReactNode } from "react";
import { StaffProvider } from "../../components/staff/staff-context";
import { StaffShell } from "../../components/staff/staff-shell";
import "../kafka.css";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <StaffProvider>
      <StaffShell>{children}</StaffShell>
    </StaffProvider>
  );
}
