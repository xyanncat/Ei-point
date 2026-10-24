// The role ladder.
//
//   user   — a signed-in customer. Sees the servers they invited bots to and
//            their own purchase logs.
//   admin  — the owner operator. Everything a user has, plus global control
//            of the service catalogue (price, details, add, remove).
//   master — the single highest identity. Everything an admin has, plus the
//            power to see and edit every server, and to remove a bot from a
//            server. Bots do not refuse a master command.
//
// The two elevated identities are Discord user IDs held in configuration
// (DASHBOARD_ADMIN_IDS / DASHBOARD_MASTER_IDS), not in code. The defaults in
// @ei-point/contracts are the founding operator and the master account.
import {
  DEFAULT_ADMIN_IDS,
  DEFAULT_MASTER_IDS,
  roleIdsFromEnv,
  type Role,
} from "@ei-point/contracts";

export type { Role };

export class Roles {
  readonly admins: string[];
  readonly masters: string[];

  constructor(env: Record<string, string | undefined>) {
    this.admins = roleIdsFromEnv(env.DASHBOARD_ADMIN_IDS, DEFAULT_ADMIN_IDS);
    this.masters = roleIdsFromEnv(env.DASHBOARD_MASTER_IDS, DEFAULT_MASTER_IDS);
  }

  isMaster(id: string): boolean {
    return this.masters.includes(id);
  }

  isAdmin(id: string): boolean {
    return this.isMaster(id) || this.admins.includes(id);
  }

  /** The highest role an identity holds. Master outranks admin. */
  role(id: string): Role {
    if (this.isMaster(id)) return "master";
    if (this.admins.includes(id)) return "admin";
    return "user";
  }
}

/**
 * Role preview for testing. The master — and only the master — may ask the
 * API to treat them as a lower role, so every segment can be walked with one
 * login. Downgrade-only: a master may preview as admin or user; anyone else
 * gets nothing back, so previewing can never escalate. Master-only guards
 * always check the real identity, never the preview.
 */
export function resolvePreview(real: Role, raw: unknown): Role | null {
  if (real !== "master") return null;
  return raw === "user" || raw === "admin" ? raw : null;
}
