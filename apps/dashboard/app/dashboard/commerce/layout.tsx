import type { ReactNode } from "react";
import { SectionTabs } from "../../../components/staff/section-tabs";

export default function CommerceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs section="/dashboard/commerce" />
      {children}
    </>
  );
}
