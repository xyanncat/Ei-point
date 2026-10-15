import { it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { snapshotChecksum } from "@ei-point/module-security";
import { respondToSecurityCommand, type SecurityCommandRequest } from "./commands.js";
function request(overrides: Partial<SecurityCommandRequest>): SecurityCommandRequest {
  return { name: "security", subcommandGroup: "snapshot", subcommand: "restore", options: { snapshot_id: "snapshot" },
    guildId: "guild", userId: "actor", key: "interaction", isOwner: false, canManage: true,
    defer: async () => {}, reply: async () => {}, getGuildChannels: async () => [], getGuildRoles: async () => [], ...overrides };
}
it("Manage Server alone cannot execute snapshot restoration", async () => {
  let called = false, reply = ""; const payload = { version: 2, guildId: "guild", roles: [], channels: [], settings: {} };
  const pool = { query: async () => ({ rows: [{ payload, checksum: snapshotChecksum(payload) }] }) } as unknown as Pool;
  await respondToSecurityCommand(request({ restoreSnapshot: async () => { called = true; }, reply: async value => { reply = value; } }),pool);
  assert.equal(called,false); assert.match(reply,/Only the current guild owner/);
});
it("owner gets a specific unsupported legacy snapshot result with no executor call", async () => {
  let called = false, reply = ""; const payload = { channel: { name: "legacy", kind: "channel" } };
  const pool = { query: async () => ({ rows: [{ payload, checksum: snapshotChecksum(payload) }] }) } as unknown as Pool;
  await respondToSecurityCommand(request({ isOwner: true, restoreSnapshot: async () => { called = true; }, reply: async value => { reply = value; } }),pool);
  assert.equal(called,false); assert.match(reply,/Unsupported legacy/);
});
it("lockdown command cannot report engagement without a Discord executor", async () => {
  let reply = "";
  await assert.rejects(respondToSecurityCommand(request({ subcommandGroup: undefined, subcommand: "lockdown", options: { mode: "on" }, reply: async value => { reply = value; } }),{} as Pool), /executor unavailable/);
  assert.equal(reply,"");
});
