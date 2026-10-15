import { it } from "node:test";
import assert from "node:assert/strict";
import { executeRestore, validateRestorableSnapshot, type GuildSnapshot, type RestoreAdapter } from "./snapshot.js";
function snapshot(): GuildSnapshot {
  return { version: 2, guildId: "guild", roles: [
    { id: "guild", managed: false, position: 0, name: "@everyone", permissions: "1", color: 0, hoist: false, mentionable: false },
    { id: "old-role", managed: false, position: 2, name: "Members", permissions: "1024", color: 123, hoist: true, mentionable: false }],
    channels: [
      { id: "old-text", name: "chat", type: 0, position: 2, parentId: "old-category", overwrites: [{ id: "old-role", type: 0, allow: "1024", deny: "32" }, { id: "user", type: 1, allow: "2", deny: "0" }], options: { topic: "saved topic", nsfw: true } },
      { id: "old-category", name: "Group", type: 4, position: 1, parentId: null, overwrites: [], options: {} }],
    settings: { name: "Guild", systemChannelId: "old-text" } };
}
function adapter(trace: string[]): RestoreAdapter {
  return { roleExists: id => id === "guild", channelExists: () => false,
    putRole: async (role,id) => { trace.push(`role:${role.id}:${role.permissions}`); return id ?? "new-role"; },
    putChannel: async (channel,parent,overwrites) => { trace.push(`channel:${channel.id}:${parent}:${JSON.stringify(overwrites)}:${JSON.stringify(channel.options)}`); return channel.type === 4 ? "new-category" : "new-text"; },
    setPositions: async (roles,channels) => { trace.push(`positions:${JSON.stringify({ roles, channels })}`); },
    setSettings: async settings => { trace.push(`settings:${JSON.stringify(settings)}`); },
    checkpoint: async (step,ids,work) => { trace.push(`intent:${step}`); await work(); trace.push(`done:${step}:${JSON.stringify(ids)}`); } };
}
it("recovery remaps roles, parent categories, channel overwrites and guild settings in order", async () => {
  const trace: string[] = [], ids = {};
  await executeRestore(snapshot(),adapter(trace),ids);
  assert.deepEqual(ids, { guild: "guild", "old-role": "new-role", "old-category": "new-category", "old-text": "new-text" });
  const category = trace.findIndex(value => value.startsWith("channel:old-category"));
  const text = trace.findIndex(value => value.startsWith("channel:old-text"));
  assert.ok(category < text); assert.match(trace[text]!, /new-category/); assert.match(trace[text]!, /"id":"new-role"/);
  assert.match(trace[text]!, /"id":"user"/); assert.match(trace[text]!, /saved topic/);
  assert.ok(trace.some(value => value.includes('settings:{"name":"Guild","systemChannelId":"new-text"}')));
  assert.ok(trace.some(value => value.startsWith("positions:") && value.includes('"id":"new-role","position":2')));
  assert.ok(trace.indexOf("intent:role:old-role") < trace.indexOf("role:old-role:1024"));
});
it("unsupported channel types and legacy snapshots are rejected before effects", async () => {
  const trace: string[] = []; const data = snapshot(); data.channels[0]!.type = 15;
  await assert.rejects(executeRestore(data,adapter(trace),{}), /Unsupported snapshot channel types/); assert.equal(trace.length,0);
  assert.throws(() => validateRestorableSnapshot({ channel: { name: "old" } }, "guild"), /legacy/);
});
it("unrecreatable managed roles fail preflight without partial Discord changes", async () => {
  const trace: string[] = [], data = snapshot(); data.roles[1]!.managed = true;
  await assert.rejects(executeRestore(data,adapter(trace),{}), /cannot be recreated/); assert.equal(trace.length,0);
});
it("failed Discord create has no completion checkpoint or invented remapped id", async () => {
  const trace: string[] = [], ids = {}, deps = adapter(trace);
  deps.putChannel = async () => { throw new Error("Discord outcome unknown"); };
  await assert.rejects(executeRestore(snapshot(),deps,ids), /outcome unknown/);
  assert.equal("old-category" in ids,false); assert.equal(trace.some(value => value.startsWith("done:channel:")),false);
});
