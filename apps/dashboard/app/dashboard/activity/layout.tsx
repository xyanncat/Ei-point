import type { ReactNode } from "react";
import { SectionTabs } from "../../../components/staff/section-tabs";

export default function ActivityLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs section="/dashboard/activity" />
      {children}
    </>
  );
}
