// Provider selection for Cyrene TTS (redesign infrastructure §6).
// No network is touched: fetch is replaced with a stub that records calls, and
// the local adapter must be selectable purely by configuration.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  googleLanguageCode,
  makeTtsProvider,
  ttsProviderName,
  ttsTotalDeadlineMs,
  MAX_TTS_AUDIO_BYTES,
} from "./tts.js";
import { createFailureGate, fetchWithBoundedRetry, readBoundedBody } from "./http.js";

function wavResponse(bytes = new Uint8Array([1, 2, 3])) {
  return new Response(bytes, { status: 200, headers: { "Content-Type": "audio/wav" } });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function neverAborted() {
  return new AbortController().signal;
}

describe("TTS provider selection", () => {
  it("defaults to the local adapter that posts {text,voice,format} and reads WAV", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body ?? "{}")) });
      return wavResponse();
    }) as typeof fetch;
    const synthesize = makeTtsProvider({ TTS_URL: "http://tts:3120/v1/audio/speech" }, fetchFn);
    const audio = await synthesize("hello", "default", neverAborted());
    assert.equal(audio.mime, "audio/wav");
    assert.deepEqual([...audio.bytes], [1, 2, 3]);
    assert.equal(calls[0]!.url, "http://tts:3120/v1/audio/speech");
    const body = calls[0]!.body as { text: string; voice: string; format: string };
    assert.equal(body.text, "hello");
    assert.equal(body.format, "wav");
    assert.equal(ttsProviderName({}), "local-tts");
  });

  it("rejects non-WAV content from the local adapter", async () => {
    const wrongType = (async () =>
      new Response(new Uint8Array([9]), { headers: { "Content-Type": "text/html" } })) as typeof fetch;
    const synthesize = makeTtsProvider({ TTS_URL: "http://x/v1/audio/speech" }, wrongType);
    await assert.rejects(synthesize("hi", "default", neverAborted()), /tts-invalid-content-type/);
  });

  it("selects the Google adapter and returns bounded MP3 bytes", async () => {
    const calls: Array<{ url: string; body: { input: { text: string }; voice: { name: string } } }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body ?? "{}")) });
      return jsonResponse({ audioContent: Buffer.from([0x49, 0x44, 0x33]).toString("base64") });
    }) as typeof fetch;
    const synthesize = makeTtsProvider(
      { TTS_PROVIDER: "google", GOOGLE_TTS_API_KEY: "key-1" },
      fetchFn,
    );
    const audio = await synthesize("Hello there", "default", neverAborted());
    assert.equal(audio.mime, "audio/mpeg");
    assert.deepEqual([...audio.bytes], [0x49, 0x44, 0x33]);
    assert.match(calls[0]!.url, /texttospeech\.googleapis\.com/);
    assert.equal(calls[0]!.body.voice.name, "en-US-Standard-C");
    assert.equal(ttsProviderName({ TTS_PROVIDER: "google" }), "google-tts");
  });

  it("Google without a key fails closed with a typed code, never a local call", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return wavResponse();
    }) as typeof fetch;
    const synthesize = makeTtsProvider({ TTS_PROVIDER: "google" }, fetchFn);
    await assert.rejects(synthesize("hi", "default", neverAborted()), /tts-provider-unconfigured/);
    assert.equal(called, false);
  });

  it("Google maps a catalog voice name to its language code", () => {
    assert.equal(googleLanguageCode("en-US-Chirp3-HD-Aoede"), "en-US");
    assert.equal(googleLanguageCode("en-US-Standard-C"), "en-US");
  });

  it("unknown TTS provider names fail closed", async () => {
    const synthesize = makeTtsProvider({ TTS_PROVIDER: "carrier-pigeon" }, (async () => wavResponse()) as typeof fetch);
    await assert.rejects(synthesize("hi", "default", neverAborted()), /tts-provider-unknown/);
    assert.equal(ttsProviderName({ TTS_PROVIDER: "carrier-pigeon" }), "unconfigured");
  });

  it("total deadline is bounded by the module maximum", () => {
    assert.equal(ttsTotalDeadlineMs({}), 90_000);
    assert.equal(ttsTotalDeadlineMs({ TTS_TOTAL_DEADLINE_SECONDS: "10" }), 10_000);
    assert.equal(ttsTotalDeadlineMs({ TTS_TOTAL_DEADLINE_SECONDS: "600" }), 90_000);
    assert.equal(ttsTotalDeadlineMs({ TTS_TOTAL_DEADLINE_SECONDS: "nonsense" }), 90_000);
  });

  it("audio larger than the bound is refused before decoding", async () => {
    const tooBig = Buffer.alloc(MAX_TTS_AUDIO_BYTES + 1, 0x41);
    const fetchFn = (async () =>
      jsonResponse({ audioContent: tooBig.toString("base64") })) as typeof fetch;
    const synthesize = makeTtsProvider({ TTS_PROVIDER: "google", GOOGLE_TTS_API_KEY: "k" }, fetchFn);
    await assert.rejects(synthesize("hi", "default", neverAborted()), /tts-audio-too-large/);
  });
});

describe("shared HTTP helpers", () => {
  it("readBoundedBody cancels a stream that exceeds the limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.enqueue(new Uint8Array([7, 8, 9]));
        controller.close();
      },
    });
    await assert.rejects(readBoundedBody(stream, 5, "too-large"), /too-large/);
  });

  it("fetchWithBoundedRetry does not retry non-retryable statuses", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response("nope", { status: 401 });
    }) as typeof fetch;
    const response = await fetchWithBoundedRetry(fetchFn, "https://x", { method: "GET" }, { retryDelayMs: 1 });
    assert.equal(response.status, 401);
    assert.equal(calls, 1);
  });

  it("fetchWithBoundedRetry retries a 429 once then succeeds", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return calls === 1 ? new Response("slow", { status: 429 }) : jsonResponse({ ok: true });
    }) as typeof fetch;
    const response = await fetchWithBoundedRetry(fetchFn, "https://x", { method: "GET" }, { retryDelayMs: 1 });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  });

  it("failure gate opens after repeated failures and closes on success", () => {
    let nowMs = 1_000_000;
    const gate = createFailureGate({ threshold: 2, cooldownMs: 5_000, now: () => nowMs });
    assert.equal(gate.allow(), true);
    gate.fail();
    assert.equal(gate.allow(), true);
    gate.fail();
    assert.equal(gate.allow(), false);
    nowMs += 5_000;
    assert.equal(gate.allow(), true);
    gate.ok();
    gate.fail();
    assert.equal(gate.allow(), true);
  });
});
