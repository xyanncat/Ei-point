import { it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { respondToModerationCommand, executeSanction, type ModerationCommandRequest } from "./commands.js";
function request(overrides: Partial<ModerationCommandRequest> = {}): ModerationCommandRequest {
  return { name: "cases", options: { user: "target" }, guildId: "guild", userId: "actor", key: "interaction-1",
    isOwner: false, canManage: false, userScopes: [], defer: async () => {}, reply: async () => {},
    banUser: async () => {}, unbanUser: async () => {}, timeoutMember: async () => {}, clearTimeout: async () => {}, bulkDeleteMessages: async () => 0, ...overrides };
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

it("warn remove voids the guild-scoped warning and records the moderator reason atomically", async () => {
  const trace: string[] = [];
  const client = { query: async (sql: string, args: unknown[] = []) => {
    if (sql === "BEGIN" || sql === "COMMIT") { trace.push(sql); return { rows: [] }; }
    if (sql.includes("idempotency_key=$1")) return { rows: [] };
    if (sql.includes("kind='warn'")) return { rows: [{ user_id: "target" }] };
    if (sql.includes("UPDATE moderation.cases")) { trace.push(`void:${args[0]}`); return { rows: [] }; }
    if (sql.includes("INSERT INTO moderation.cases")) { trace.push(String(args[2])); return { rows: [{ case_id: "22" }] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, release: () => trace.push("release") };
  let reply = "";
  await respondToModerationCommand(request({ name: "warn", subcommand: "remove", options: { case_id: 12, reason: "appeal accepted" }, canManage: true, reply: async text => { reply = text; } }), { connect: async () => client } as unknown as Pool);
  assert.deepEqual(trace, ["BEGIN", "void:12", "Removed warning case #12: appeal accepted", "COMMIT", "release"]);
  assert.match(reply, /audit case #22/);
});

it("timeout removal persists intent before clearing the Discord timeout", async () => {
  const trace: string[] = [];
  const pool = { query: async (sql: string) => {
    if (sql.includes("INSERT INTO moderation.cases")) { trace.push("intent"); return { rows: [{ case_id: "23" }] }; }
    trace.push("applied"); return { rows: [] };
  } } as unknown as Pool;
  let reply = "";
  await respondToModerationCommand(request({ name: "timeout", subcommand: "remove", options: { user: "target", reason: "review complete" }, canManage: true, targetMember: { moderatable: true } as never,
    clearTimeout: async (_member, reason) => { assert.equal(reason, "review complete"); trace.push("discord-clear"); }, reply: async text => { reply = text; } }), pool);
  assert.deepEqual(trace, ["intent", "discord-clear", "applied"]);
  assert.match(reply, /Removed <@target>'s timeout/);
});

it("temporary role persists expiry metadata before granting the selected role", async () => {
  const trace: string[] = [];
  const pool = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes("INSERT INTO moderation.cases")) { trace.push(`intent:${JSON.stringify(args[7])}`); return { rows: [{ case_id: "24" }] }; }
    trace.push("applied"); return { rows: [] };
  } } as unknown as Pool;
  const role = { id: "role-1", managed: false, editable: true, permissions: { has: () => false } };
  await respondToModerationCommand(request({ name: "temp", subcommand: "role", options: { user: "target", role: "role-1", minutes: 30, reason: "event access" }, canManage: true,
    targetMember: { manageable: true, roles: { cache: { has: () => false } } } as never, targetRole: role as never,
    addMemberRole: async (_member, selected, reason) => { assert.equal(selected.id, "role-1"); assert.equal(reason, "event access"); trace.push("discord-add"); } }), pool);
  assert.equal(JSON.parse(trace[0]!.slice("intent:".length)).roleId, "role-1");
  assert.deepEqual(trace.slice(1), ["discord-add", "applied"]);
});

it("temporary restriction snapshots existing send permissions before denying them", async () => {
  const trace: string[] = [];
  const pool = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes("INSERT INTO moderation.cases")) { trace.push(`intent:${JSON.stringify(args[7])}`); return { rows: [{ case_id: "25" }] }; }
    trace.push("applied"); return { rows: [] };
  } } as unknown as Pool;
  await respondToModerationCommand(request({ name: "temp", subcommand: "restriction", options: { user: "target", minutes: 15, reason: "cooldown" }, canManage: true,
    targetMember: {} as never, channelId: "channel-1", getRestrictionState: async () => ({ sendMessages: true, sendMessagesInThreads: null }),
    setRestrictionState: async (channelId, userId, state) => { assert.equal(channelId, "channel-1"); assert.equal(userId, "target"); assert.deepEqual(state, { sendMessages: false, sendMessagesInThreads: false }); trace.push("discord-deny"); } }), pool);
  const metadata = JSON.parse(trace[0]!.slice("intent:".length));
  assert.equal(metadata.channelId, "channel-1");
  assert.deepEqual([metadata.previousSendMessages, metadata.previousSendMessagesInThreads], [true, null]);
  assert.deepEqual(trace.slice(1), ["discord-deny", "applied"]);
});

it("unsupported temporary restriction reads return a handled error before writing a case", async () => {
  let queries = 0, reply = "";
  await respondToModerationCommand(request({ name: "temp", subcommand: "restriction", options: { user: "target", minutes: 15, reason: "cooldown" }, canManage: true,
    targetMember: {} as never, channelId: "uncached-channel", getRestrictionState: async () => { throw new Error("unsupported channel"); },
    setRestrictionState: async () => {}, reply: async (text) => { reply = text; } }), { query: async () => { queries++; return { rows: [] }; } } as unknown as Pool);
  assert.equal(queries, 0);
  assert.match(reply, /cannot be temporarily restricted/);
});
