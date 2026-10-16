import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import EmbeddedPostgres from "../helpers/embedded-postgres.mjs";
import { processConversation, answerCyreneSearch } from "../../apps/bots/ai/dist/commands.js";
import { acquireVoiceLease } from "../../apps/bots/ai/dist/voice-lease.js";
let server, pool;
const guild = "100000000000000001",
  identity = "custom-crew";
before(
  async () => {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    server = new EmbeddedPostgres({
      databaseDir: await mkdtemp(join(tmpdir(), "ei-ai-")),
      port,
      user: "postgres",
      password: "isolated-test-only",
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    pool = new pg.Pool({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password: "isolated-test-only",
      database: "postgres",
      max: 5,
    });
    const dir = new URL("../../infra/postgres/migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(await readFile(new URL(name, dir), "utf8"));
  },
  { timeout: 120000 },
);
after(async () => {
  await pool?.end();
  await server?.stop();
});

beforeEach(async () => {
 await pool.query("TRUNCATE ai.threads,ai.messages,ai.usage_ledger,ai.budget_reservations,ai.voice_leases CASCADE");
});
const success = async () => ({ok:true,via:"primary",result:{text:"provider reply",tokensIn:10,tokensOut:10}});
test("concurrent requests reserve budget before providers and only one fits", async () => {
 let entered=0;
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const provider=async()=>{entered++; await gate;return success();};
 const requests=Array.from({length:2},()=>processConversation(pool,"guild","user","default","hello",provider,1100));
 // Observe the durable reservation, not a timing-only assertion.
 for(let attempt=0;attempt<100;attempt++) {
   if(entered===1)break;
   await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.equal(entered,1);
 assert.equal((await pool.query("SELECT count(*)::int count FROM ai.budget_reservations")).rows[0].count,1);
 const rejected = await Promise.race(requests);
 assert.match(rejected,/budget/);
 release();
 const replies=await Promise.all(requests);
 assert.equal(replies.filter(r=>r==="provider reply").length,1);
 assert.match(replies.find(r=>r!=="provider reply"),/budget/);
 assert.equal((await pool.query("SELECT count(*)::int count FROM ai.usage_ledger")).rows[0].count,1);
});
test("provider failure leaves no invented usage or memory and frees admission", async()=>{
 const reply=await processConversation(pool,"guild","user","default","hello",async()=>({ok:false,reason:"all-failed"}),5000);
 assert.match(reply,/unreachable/);
 for(const table of ["usage_ledger","messages","budget_reservations"])
   assert.equal((await pool.query(`SELECT count(*)::int count FROM ai.${table}`)).rows[0].count,0);
});
test("summary is persisted and included on subsequent requests",async()=>{
 await processConversation(pool,"guild","user","default","remember this",success,20000);
 const row=(await pool.query("SELECT summary FROM ai.threads")).rows[0];
 assert.match(row.summary,/remember this/);
 let prompt;
 await processConversation(pool,"guild","user","default","next",async messages=>{prompt=messages;return success();},20000);
 assert.match(prompt[0].content,/Conversation summary so far:.*remember this/s);
});
test("atomic fleet voice admission includes music owners and recovers expired leases",async()=>{
 const admissions=await Promise.all([acquireVoiceLease(pool,"music:g1"),acquireVoiceLease(pool,"tts:g1"),acquireVoiceLease(pool,"tts:g2")]);
 assert.equal(admissions.filter(Boolean).length,2);
 assert.equal((await pool.query("SELECT count(*)::int count FROM ai.voice_leases")).rows[0].count,2);
 await pool.query("UPDATE ai.voice_leases SET expires_at=now()-interval '1 second'");
 assert.equal(await acquireVoiceLease(pool,"tts:replacement"),true);
 assert.equal((await pool.query("SELECT count(*)::int count FROM ai.voice_leases")).rows[0].count,1);
});

test("post-provider persistence failure rolls memory back and retains conservative daily reservation",async()=>{
 await pool.query("CREATE FUNCTION ai.reject_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected-write-failure'; END $$");
 await pool.query("CREATE TRIGGER reject_message BEFORE INSERT ON ai.messages FOR EACH ROW EXECUTE FUNCTION ai.reject_message()");
 try {
   await assert.rejects(processConversation(pool,"guild","user","default","hello",success,20000),/injected-write-failure/);
   assert.equal((await pool.query("SELECT count(*)::int count FROM ai.messages")).rows[0].count,0);
   assert.equal((await pool.query("SELECT count(*)::int count FROM ai.usage_ledger")).rows[0].count,0);
   assert.equal((await pool.query("SELECT count(*)::int count FROM ai.budget_reservations")).rows[0].count,1);
 } finally {
   await pool.query("DROP TRIGGER reject_message ON ai.messages");
   await pool.query("DROP FUNCTION ai.reject_message()");
 }
});
test("Cyrene /search answers through the AI conversation contract, not a stub",async()=>{
 let prompt;
 const answer=await answerCyreneSearch(pool,"guild","searcher","who runs the server?",async messages=>{prompt=messages;return success();},20000);
 assert.equal(answer,"provider reply");
 assert.match(prompt.at(-1).content,/who runs the server\?/);
 const usage=(await pool.query("SELECT count(*)::int count FROM ai.usage_ledger")).rows[0].count;
 const messages=(await pool.query("SELECT count(*)::int count FROM ai.messages")).rows[0].count;
 assert.equal(usage,1);
 assert.equal(messages,2);
});
test("Cyrene /search reports an honest unavailable state and records nothing",async()=>{
 const answer=await answerCyreneSearch(pool,"guild","searcher","hello",async()=>({ok:false,reason:"all-failed"}),20000);
 assert.match(answer,/unreachable/);
 for(const table of ["usage_ledger","messages","budget_reservations"])
   assert.equal((await pool.query(`SELECT count(*)::int count FROM ai.${table}`)).rows[0].count,0);
});
