import { it } from "node:test";
import assert from "node:assert/strict";
import type { Guild } from "discord.js";
import type { Pool } from "pg";
import { applyLockdown } from "./lockdown.js";
function fixture() {
  const trace: string[] = []; let state: any; let fail = false;
  const cache = new Map();
  const channel = { id: "channel", permissionOverwrites: { cache,
    edit: async () => { trace.push("discord-restrict"); if (fail) throw new Error("Discord failure"); },
    delete: async () => { trace.push("discord-delete-overwrite"); },
    set: async (values: any[]) => { trace.push(`discord-restore:${values[0]?.allow}:${values[0]?.deny}`); } } };
  const guild = { id: "guild", verificationLevel: 1, channels: { fetch: async () => new Map([["channel", channel]]) },
    setVerificationLevel: async (level: number) => { trace.push(`verification:${level}`); } } as unknown as Guild;
  const db = { query: async (sql: string, args: any[]) => {
    if (sql.includes("SELECT original_permissions")) return { rows: state ? [state] : [] };
    if (sql.includes("INSERT INTO security")) { state = { original_permissions: JSON.parse(args[3]), active: true, status: "pending" }; trace.push("durable-original"); }
    if (sql.includes("effects_status='applied'")) { state.status = "applied"; trace.push("applied"); }
    if (sql.includes("active=false")) { state = undefined; trace.push("restored"); }
    return { rows: [] };
  }, release: () => {} };
  const pool = { connect: async () => db } as unknown as Pool;
  return { trace, pool, guild, cache, setFail: (value: boolean) => { fail = value; }, state: () => state };
}
it("lockdown persists originals before effects and restores exact overwrite bits", async () => {
  const f = fixture(); f.cache.set("guild", { id: "guild", type: 0, allow: { bitfield: 1024n }, deny: { bitfield: 32n } });
  await applyLockdown(f.pool, f.guild, true, "actor", "test");
  assert.equal(f.trace[0], "durable-original"); assert.equal(f.state().status, "applied");
  await applyLockdown(f.pool, f.guild, false, "actor", "test");
  assert.ok(f.trace.includes("discord-restore:1024:32")); assert.ok(f.trace.includes("verification:1")); assert.equal(f.state(), undefined);
});
it("partial Discord failure retains durable originals and never claims applied", async () => {
  const f = fixture(); f.setFail(true);
  await assert.rejects(applyLockdown(f.pool, f.guild, true, "actor", "test"), /Discord failure/);
  assert.equal(f.state().status, "pending"); assert.deepEqual(f.state().original_permissions.channels.channel, []);
  assert.equal(f.trace.includes("applied"), false);
});
it("missing recovery image fails closed", async () => {
  const f = fixture(); await assert.rejects(applyLockdown(f.pool, f.guild, false, "actor", "test"), /manual recovery/);
  assert.equal(f.trace.length, 0);
});
