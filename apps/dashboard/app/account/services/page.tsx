"use client";
// Services tab. Only the operator and the master have one. A customer who
// lands here is sent back to their servers.
import { useStaff } from "../../../components/staff/staff-context";
import { CatalogueManager } from "../../../components/account/catalogue-manager";

export default function AccountServicesPage() {
  const { isAdmin, isMaster } = useStaff();

  if (!isAdmin && !isMaster)
    return (
      <div className="world-empty">
        <h1 className="world-title world-title--sm">Not available for your role</h1>
        <p className="world-note">
          The service catalogue belongs to the operator. Your own services and
          servers are under the servers tab.
        </p>
      </div>
    );

  return <CatalogueManager />;
}
