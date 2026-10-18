import type { ReactNode } from "react";
import { SectionTabs } from "../../../components/staff/section-tabs";

export default function SystemLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs section="/dashboard/system" />
      {children}
    </>
  );
}
