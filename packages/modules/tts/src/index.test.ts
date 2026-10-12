import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTtsQueue,
  normalizeVoice,
  ttsCacheKey,
  validateTtsInput,
  TTS_MAX_CHARS,
} from "./index.js";

describe("validateTtsInput", () => {
  it("accepts normal text, collapses whitespace", () => {
    assert.deepEqual(validateTtsInput("  hello   world "), { ok: true, text: "hello world" });
  });
  it("rejects empty and over-limit input", () => {
    assert.deepEqual(validateTtsInput("   "), { ok: false, reason: "empty" });
    assert.deepEqual(validateTtsInput("a".repeat(TTS_MAX_CHARS + 1)), {
      ok: false,
      reason: `over-limit:${TTS_MAX_CHARS}`,
    });
  });
  it("refuses likely secrets", () => {
    assert.deepEqual(validateTtsInput("token mfa.abcdefghij1234567890 here"), {
      ok: false,
      reason: "secret-rejected",
    });
  });
});

describe("cache key", () => {
  it("is stable, provider-scoped, and never embeds raw text", () => {
    const a = ttsCacheKey("Primary", "Aria", "hello world");
    const b = ttsCacheKey("primary", "aria", "hello world");
    const c = ttsCacheKey("primary", "aria", "hello world!");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.ok(!a.includes("hello"));
    assert.ok(a.startsWith("v1/primary/aria/"));
  });
  it("normalizes voices", () => {
    assert.equal(normalizeVoice(null), "default");
    assert.equal(normalizeVoice("  Aria!! "), "aria");
  });
});

describe("tts queue", () => {
  it("synthesizes through the injected provider", async () => {
    const q = createTtsQueue({
      provider: "primary",
      synthesize: async (text) => ({ mime: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]), sampleRate: 24000, text } as never),
    });
    const res = await q.synthesize("hi", "aria");
    assert.equal(res.ok, true);
    if (res.ok) assert.ok(res.cacheKey.startsWith("v1/primary/aria/"));
  });
  it("rejects bad input without calling the provider", async () => {
    let calls = 0;
    const q = createTtsQueue({
      provider: "primary",
      synthesize: async () => {
        calls++;
        return { mime: "audio/mpeg", bytes: new Uint8Array() };
      },
    });
    assert.deepEqual(await q.synthesize("   ", "aria"), { ok: false, reason: "input-rejected" });
    assert.equal(calls, 0);
  });
  it("rejects over queue capacity without hanging", async () => {
    const gate = () => new Promise<never>(() => {});
    const q = createTtsQueue({ provider: "primary", synthesize: gate as never, deadlineMs: 60_000 });
    const p1 = q.synthesize("a", "v");
    const p2 = q.synthesize("b", "v");
    const queued: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i++) queued.push(q.synthesize(`q${i}`, "v"));
    assert.deepEqual(await q.synthesize("overflow", "v"), { ok: false, reason: "queue-full" });
    assert.equal(q.inFlight(), 2);
    assert.equal(q.queued(), 10);
    void p1;
    void p2;
    void queued;
  });
});
