// Command-level integration of the cost-unit budget: /speak and /translate
// admit through PostgreSQL before spending. Synthesis targets the local
// model endpoints, which refuse connections in a test environment, so the
// release-on-failure paths here run deterministically fast. The full SQLite…
// rather: the real-pool admission/settle SQL is covered in tests/ai/database.test.mjs.
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { respondToTtsCommand, type TtsCommandContext } from "./tts.js";
import { TRANSLATION_UNITS_PER_USER } from "./budget.js";

interface Recorded { sql: string; params?: unknown[] | undefined }

function makeBudgetFake(usedUnits: string) {
  const calls: Recorded[] = [];
  const client: Partial<PoolClient> = {
    query: (async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("provider LIKE $3")) return { rows: [{ used: usedUnits }] };
      if (text.includes("budget_reservations")) {
        if (text.includes("kind = $1")) return { rows: [{ reserved: "0" }] };
        return { rows: [] };
      }
      if (text.includes("provider LIKE $1")) return { rows: [{ used: "0" }] };
      return { rows: [] as unknown[] };
    }) as PoolClient["query"],
    release() {},
  };
  const pool = { query: (async (sql: string, params?: unknown[]) => client.query!(sql, params)) as unknown as Pool["query"], connect: async () => client } as unknown as Pool;
  return { pool, calls };
}

function ttsContext(overrides: Partial<TtsCommandContext>): TtsCommandContext {
  return {
    guildId: "guild",
    userId: "user",
    inVoiceChannel: false,
    reply: async () => {},
    sendAudio: async () => {},
    startTts: async () => ({ ok: true }),
    playAudio: async () => ({ ok: true }),
    stopPlayback: async () => {},
    search: async () => "answer",
    ...overrides,
  };
}

describe("/speak budget admission", () => {
  it("refuses valid text when the daily character budget is spent", async () => {
    const replies: string[] = [];
    const fake = makeBudgetFake("999999999");
    const handled = await respondToTtsCommand(
      "speak",
      ttsContext({ text: "hello there", reply: async (t) => { replies.push(t); } }),
      fake.pool,
    );
    assert.equal(handled, true);
    assert.equal(replies[0], "Your remaining daily AI budget is too small for this request.");
    assert.equal(fake.calls.some((c) => c.sql.includes("INSERT INTO ai.budget_reservations")), false);
  });

  it("reserves first and releases the hold when synthesis fails", async () => {
    const replies: string[] = [];
    const fake = makeBudgetFake("0");
    const handled = await respondToTtsCommand(
      "speak",
      ttsContext({ text: "hello there", reply: async (t) => { replies.push(t); } }),
      fake.pool,
    );
    assert.equal(handled, true);
    const texts = fake.calls.map((c) => c.sql);
    assert.ok(texts.some((t) => t.includes("BEGIN")));
    assert.ok(texts.some((t) => t.includes("INSERT INTO ai.budget_reservations")));
    assert.ok(texts.some((t) => t.includes("COMMIT")));
    assert.ok(texts.some((t) => t.includes("DELETE FROM ai.budget_reservations WHERE reservation_id=$1")));
    assert.match(replies[0]!, /TTS service is not ready|temporarily unavailable/);
    // No usage recorded for a failed synthesis.
    assert.equal(texts.some((t) => t.includes("INSERT INTO ai.usage_ledger")), false);
  });
});

describe("/translate budget admission", () => {
  // The deployed translation queue is built at module import from the chat
  // provider configuration. Clear it first so these tests never reach a real
  // provider on a developer machine; the worker then fails closed.
  let translate: typeof import("./translate.js");
  before(async () => {
    delete process.env.AI_PROVIDER_PRIMARY;
    translate = await import("./translate.js");
  });

  it("refuses valid text when the daily character budget is spent", async () => {
    const fake = makeBudgetFake(String(TRANSLATION_UNITS_PER_USER + 1));
    const result = await translate.respondToTranslationCommand(
      { text: "Hello", targetLanguage: "French" },
      { pool: fake.pool, guildId: "g", userId: "u" },
    );
    assert.equal(result, "Your remaining daily AI budget is too small for this request.");
    assert.equal(fake.calls.some((c) => c.sql.includes("INSERT INTO ai.budget_reservations")), false);
  });

  it("releases the hold when the translation provider is unavailable", async () => {
    const fake = makeBudgetFake("0");
    const result = await translate.respondToTranslationCommand(
      { text: "Hello", targetLanguage: "French" },
      { pool: fake.pool, guildId: "g", userId: "u" },
    );
    assert.equal(result, translate.TRANSLATION_UNAVAILABLE);
    const texts = fake.calls.map((c) => c.sql);
    assert.ok(texts.some((t) => t.includes("INSERT INTO ai.budget_reservations")));
    assert.ok(texts.some((t) => t.includes("DELETE FROM ai.budget_reservations WHERE reservation_id=$1")));
    assert.equal(texts.some((t) => t.includes("INSERT INTO ai.usage_ledger")), false);
  });
});
