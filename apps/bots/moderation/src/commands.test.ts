import { it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { respondToModerationCommand, executeSanction, type ModerationCommandRequest } from "./commands.js";
function request(overrides: Partial<ModerationCommandRequest> = {}): ModerationCommandRequest {
  return { name: "cases", options: { user: "target" }, guildId: "guild", userId: "actor", key: "interaction-1",
    isOwner: false, canManage: false, userScopes: [], defer: async () => {}, reply: async () => {},
    banUser: async () => {}, unbanUser: async () => {}, timeoutMember: async () => {}, bulkDeleteMessages: async () => 0, ...overrides };
}
it("ordinary members cannot query staff cases", async () => {
  let queries = 0, reply = "";
  await respondToModerationCommand(request({ reply: async text => { reply = text; } }), { query: async () => { queries++; return { rows: [{ reason: "staff secret" }] }; } } as unknown as Pool);
  assert.equal(queries, 0); assert.match(reply, /Permission denied/); assert.doesNotMatch(reply, /staff secret/);
});
it("note scope can query staff cases", async () => {
  let queries = 0;
  await respondToModerationCommand(request({ userScopes: ["moderation-note"] }), { query: async () => { queries++; return { rows: [] }; } } as unknown as Pool);
  assert.equal(queries, 1);
});
it("database intent failure prevents Discord sanction", async () => {
  let called = false;
  await assert.rejects(executeSanction({ query: async () => { throw new Error("DB unavailable"); } } as unknown as Pool,
    request(), "target", "ban", "reason", async () => { called = true; }));
  assert.equal(called, false);
});
it("durable intent precedes Discord and duplicate interactions never replay", async () => {
  const trace: string[] = []; let claimed = false; let key = "";
  const pool = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes("INSERT")) { trace.push("intent"); key = String(args[6]); if (claimed) return { rows: [] }; claimed = true; return { rows: [{ case_id: "1" }] }; }
    trace.push(sql.includes("unconfirmed") ? "unconfirmed" : "applied"); return { rows: [] };
  } } as unknown as Pool;
  await executeSanction(pool, request(), "target", "purge", "reason", async () => { trace.push("discord"); });
  assert.deepEqual(trace, ["intent", "discord", "applied"]); assert.equal(key, "moderation:guild:interaction-1:purge");
  await assert.rejects(executeSanction(pool, request(), "target", "purge", "reason", async () => { trace.push("duplicate"); }));
  assert.equal(trace.includes("duplicate"), false);
});
it("failed result recording retains an unconfirmed durable case", async () => {
  const trace: string[] = [];
  const pool = { query: async (sql: string) => {
    if (sql.includes("INSERT")) return { rows: [{ case_id: "2" }] };
    if (sql.includes("'applied'")) throw new Error("lost DB"); trace.push("unconfirmed"); return { rows: [] };
  } } as unknown as Pool;
  await assert.rejects(executeSanction(pool, request(), "target", "ban", "reason", async () => { trace.push("discord"); }), /outcome unconfirmed/);
  assert.deepEqual(trace, ["discord", "unconfirmed"]);
});
