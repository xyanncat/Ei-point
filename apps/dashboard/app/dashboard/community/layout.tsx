import type { ReactNode } from "react";
import { SectionTabs } from "../../../components/staff/section-tabs";

export default function CommunityLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs section="/dashboard/community" />
      {children}
    </>
  );
}
