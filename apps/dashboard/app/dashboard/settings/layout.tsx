import type { ReactNode } from "react";
import { SectionTabs } from "../../../components/staff/section-tabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs section="/dashboard/settings" />
      {children}
    </>
  );
}
