import type { ReactNode } from "react";
import { SectionTabs } from "../../../components/staff/section-tabs";

export default function ModerationLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs section="/dashboard/moderation" />
      {children}
    </>
  );
}
