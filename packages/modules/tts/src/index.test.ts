import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTtsQueue,
  extractVoiceChatText,
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
    const q = createTtsQueue({ provider: "primary", synthesize: gate as never, deadlineMs: 2 });
    const p1 = q.synthesize("a", "v");
    const p2 = q.synthesize("b", "v");
    const queued: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i++) queued.push(q.synthesize(`q${i}`, "v"));
    assert.deepEqual(await q.synthesize("overflow", "v"), { ok: false, reason: "queue-full" });
    assert.equal(q.inFlight(), 2);
    assert.equal(q.queued(), 10);
    await Promise.all([p1,p2,...queued]);
  });
  it("returns the overload result when the local service rejects its bounded queue", async () => {
    const q = createTtsQueue({
      provider: "qwen3-local",
      synthesize: async () => {
        const error = new Error("queue-full");
        Object.assign(error, { code: "TTS_QUEUE_FULL" });
        throw error;
      },
    });
    assert.deepEqual(await q.synthesize("hello", "default"), { ok: false, reason: "queue-full" });
  });
});

describe("extractVoiceChatText", () => {
  it("passes normal chat text through", () => {
    assert.deepEqual(extractVoiceChatText("hello everyone, how are you"), {
      ok: true,
      text: "hello everyone, how are you",
    });
  });
  it("drops bare links and markdown hyperlinks entirely", () => {
    assert.deepEqual(extractVoiceChatText("see this https://example.com/x nice"), {
      ok: true,
      text: "see this nice",
    });
    assert.deepEqual(extractVoiceChatText("read [the rules](https://example.com/rules) please"), {
      ok: true,
      text: "read please",
    });
    assert.deepEqual(extractVoiceChatText("look ![meme](https://cdn.example/m.gif) wow"), {
      ok: true,
      text: "look wow",
    });
  });
  it("drops custom and unicode emoji", () => {
    assert.deepEqual(extractVoiceChatText("hi <:wave:123456789012345678> there"), {
      ok: true,
      text: "hi there",
    });
    assert.deepEqual(extractVoiceChatText("party \u{1F389} time \u2764\uFE0F now"), {
      ok: true,
      text: "party time now",
    });
  });
  it("removes markdown, Discord mentions, and stage directions before voice playback", () => {
    assert.deepEqual(extractVoiceChatText("**Hello**, <@123456789012345678> *laughs* [waves] there"), {
      ok: true,
      text: "Hello, there",
    });
    assert.deepEqual(extractVoiceChatText("*Very important* *standpoint* words *she smiles softly* (laughs)"), {
      ok: true,
      text: "Very important standpoint words",
    });
    assert.deepEqual(extractVoiceChatText("`secret code`"), { ok: false, reason: "nothing-speakable" });
  });
  it("reports nothing-speakable when only ignored content remains", () => {
    assert.deepEqual(extractVoiceChatText("https://tenor.com/x.gif"), { ok: false, reason: "nothing-speakable" });
    assert.deepEqual(extractVoiceChatText("<:wave:123> \u{1F600}"), { ok: false, reason: "nothing-speakable" });
    assert.deepEqual(extractVoiceChatText("   "), { ok: false, reason: "nothing-speakable" });
  });
});


it("enforces the TTS deadline for a provider that ignores AbortSignal", async () => {
  const queue = createTtsQueue({provider:"test",synthesize:()=>new Promise(()=>{}),deadlineMs:5});
  assert.deepEqual(await queue.synthesize("hello","default"),{ok:false,reason:"all-failed"});
  assert.equal(queue.inFlight(),0);
});
