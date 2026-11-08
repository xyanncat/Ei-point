// Provider selection for Cyrene TTS and translation (redesign infrastructure §6).
// No network is touched: fetch is replaced with a stub that records calls, and
// the local adapter must be selectable purely by configuration.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  googleLanguageCode,
  makeTtsProvider,
  openRouterTtsModels,
  ttsProviderName,
  ttsTotalDeadlineMs,
  MAX_TTS_AUDIO_BYTES,
} from "./tts.js";
import {
  GOOGLE_LANGUAGE_CODES,
  makeTranslationWorker,
} from "./translate.js";
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
    assert.equal(ttsProviderName({}), "pocket-local");
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

describe("OpenRouter speech provider", () => {
  it("posts to the OpenAI-compatible speech endpoint and omits a voice unless configured", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }) as typeof fetch;
    const synthesize = makeTtsProvider({ TTS_PROVIDER: "openrouter", OPENROUTER_API_KEY: "or-key" }, fetchFn);
    const audio = await synthesize("hello", "default", neverAborted());
    assert.equal(audio.mime, "audio/mpeg");
    assert.deepEqual([...audio.bytes], [0x49, 0x44, 0x33]);
    assert.equal(calls[0]!.url, "https://openrouter.ai/api/v1/audio/speech");
    assert.equal(calls[0]!.body.model, "fish-audio/s2.1-pro-free:free");
    assert.equal(calls[0]!.body.input, "hello");
    assert.equal(calls[0]!.body.response_format, "mp3");
    // Fish Audio has no stock voices; sending one would be rejected.
    assert.equal("voice" in calls[0]!.body, false);
    assert.equal(calls[0]!.headers.Authorization, "Bearer or-key");
    assert.equal(ttsProviderName({ TTS_PROVIDER: "openrouter" }), "openrouter-speech");
  });

  it("sends a configured voice and delivery instructions", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
      return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }) as typeof fetch;
    const synthesize = makeTtsProvider(
      {
        TTS_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "or-key",
        TTS_PROVIDER_VOICE: "alloy",
        TTS_PROVIDER_INSTRUCTIONS: "warm and gentle",
      },
      fetchFn,
    );
    await synthesize("hello", "default", neverAborted());
    assert.equal(calls[0]!.voice, "alloy");
    assert.equal(calls[0]!.instructions, "warm and gentle");
  });

  it("rotates to the next model after a rate limit and succeeds", async () => {
    const seen: string[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}")) as { model: string };
      seen.push(body.model);
      if (seen.length === 1) return new Response("slow down", { status: 429 });
      return new Response(new Uint8Array([7]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }) as typeof fetch;
    const synthesize = makeTtsProvider(
      {
        TTS_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "or-key",
        TTS_PROVIDER_MODELS: "fish-audio/s2.1-pro-free:free,hexgrad/kokoro-82m",
      },
      fetchFn,
    );
    const audio = await synthesize("hello", "default", neverAborted());
    assert.deepEqual([...audio.bytes], [7]);
    assert.deepEqual(seen, ["fish-audio/s2.1-pro-free:free", "hexgrad/kokoro-82m"]);
  });

  it("reports an honest quota failure when every model is rate limited", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response("slow down", { status: 429 });
    }) as typeof fetch;
    const synthesize = makeTtsProvider(
      {
        TTS_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "or-key",
        TTS_PROVIDER_MODELS: "fish-audio/s2.1-pro-free:free,hexgrad/kokoro-82m",
      },
      fetchFn,
    );
    await assert.rejects(
      synthesize("hello", "default", neverAborted()),
      (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "TTS_QUOTA",
    );
    assert.equal(calls, 2);
  });

  it("does not rotate a rejected request: a bad voice is an operator error", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response("bad voice", { status: 400 });
    }) as typeof fetch;
    const synthesize = makeTtsProvider(
      {
        TTS_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "or-key",
        TTS_PROVIDER_MODELS: "fish-audio/s2.1-pro-free:free,hexgrad/kokoro-82m",
      },
      fetchFn,
    );
    await assert.rejects(synthesize("hello", "default", neverAborted()), /tts-provider-rejected-400/);
    assert.equal(calls, 1);
  });

  it("clones a reference voice only when one is configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ei-openrouter-"));
    const reference = join(directory, "cyrene.mp3");
    await writeFile(reference, Buffer.from([0x49, 0x44, 0x33]));
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
      return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }) as typeof fetch;

    const without = makeTtsProvider({ TTS_PROVIDER: "openrouter", OPENROUTER_API_KEY: "or-key" }, fetchFn);
    await without("hello", "default", neverAborted());
    assert.equal("input_references" in bodies[0]!, false);

    const withReference = makeTtsProvider(
      {
        TTS_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "or-key",
        TTS_PROVIDER_REFERENCE_AUDIO_PATH: reference,
        TTS_PROVIDER_REFERENCE_TEXT: "reference transcript",
      },
      fetchFn,
    );
    await withReference("hello", "default", neverAborted());
    const references = bodies[1]!.input_references as Array<Record<string, unknown>>;
    assert.equal(references.length, 2);
    assert.match(String((references[0]!.input_audio as { data: string }).data), /^data:audio\/mpeg;base64,/);
    assert.equal(references[1]!.type, "text");
  });

  it("fails closed when a configured reference audio file is missing", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }) as typeof fetch;
    const synthesize = makeTtsProvider(
      {
        TTS_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "or-key",
        TTS_PROVIDER_REFERENCE_AUDIO_PATH: join(tmpdir(), "ei-missing-reference.mp3"),
      },
      fetchFn,
    );
    await assert.rejects(synthesize("hello", "default", neverAborted()), /tts-reference-unavailable/);
    assert.equal(called, false);
  });

  it("without a key it fails closed and never calls the provider", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }) as typeof fetch;
    const synthesize = makeTtsProvider({ TTS_PROVIDER: "openrouter" }, fetchFn);
    await assert.rejects(synthesize("hi", "default", neverAborted()), /tts-provider-unconfigured/);
    assert.equal(called, false);
  });

  it("uses the configured rotation order and the free-tier defaults", () => {
    assert.deepEqual(openRouterTtsModels({}), [
      "fish-audio/s2.1-pro-free:free",
      "heygen/heygen-voice-1-turbo:free",
      "hexgrad/kokoro-82m",
    ]);
    assert.deepEqual(openRouterTtsModels({ TTS_PROVIDER_MODELS: "a/b , c/d " }), ["a/b", "c/d"]);
  });
});

describe("translation provider selection", () => {
  it("defaults to the chat worker without a provider variable", () => {
    // Constructing must not throw or attempt a fetch; no call is made here.
    assert.doesNotThrow(() => makeTranslationWorker({}));
    assert.doesNotThrow(() => makeTranslationWorker({ TRANSLATION_PROVIDER: "" }));
    assert.doesNotThrow(() => makeTranslationWorker({ TRANSLATION_PROVIDER: "local" }));
  });

  it("translates through the configured OpenAI-compatible chat provider", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | undefined }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
        auth: (init.headers as Record<string, string> | undefined)?.Authorization,
      });
      return jsonResponse({ choices: [{ message: { content: "Bonjour" } }] });
    }) as typeof fetch;
    const worker = makeTranslationWorker(
      {
        AI_PROVIDER_PRIMARY: "https://api.groq.com/openai/v1/chat/completions",
        AI_PROVIDER_PRIMARY_KEY: "gsk-test",
        AI_PROVIDER_PRIMARY_MODEL: "openai/gpt-oss-20b",
      },
      fetchFn,
    );
    const text = await worker({ text: "Hello", targetLanguage: "French" }, neverAborted());
    assert.equal(text, "Bonjour");
    assert.equal(calls[0]!.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(calls[0]!.body.model, "openai/gpt-oss-20b");
    assert.equal(calls[0]!.auth, "Bearer gsk-test");
    assert.equal("temperature" in calls[0]!.body, false);
    assert.match(String((calls[0]!.body.messages as Array<{ content: string }>)[1]!.content), /from untrusted|untrusted content/i);
  });

  it("fails closed when the chat provider is not configured", async () => {
    let called = false;
    const worker = makeTranslationWorker({}, (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch);
    await assert.rejects(worker({ text: "x", targetLanguage: "French" }, neverAborted()), /translation-provider-unconfigured/);
    assert.equal(called, false);
  });

  it("Google translation maps supported language names to BCP-47 codes", () => {
    for (const [name, code] of Object.entries(GOOGLE_LANGUAGE_CODES)) {
      assert.match(code, /^[a-z]{2}(-[A-Z]{2})?$/, `${name} should map to a code`);
    }
    assert.equal(GOOGLE_LANGUAGE_CODES["Arabic"], "ar");
    assert.equal(GOOGLE_LANGUAGE_CODES["Traditional Chinese"], "zh-TW");
    assert.equal(GOOGLE_LANGUAGE_CODES["Chinese"], "zh-CN");
    assert.equal(GOOGLE_LANGUAGE_CODES["Hebrew"], "iw");
  });

  it("Google translation calls the v2 endpoint and unescapes entities", async () => {
    const fetchFn = (async () =>
      jsonResponse({ data: { translations: [{ translatedText: "Bonjour &amp; bienvenue &#39;ami&#39;" }] } })) as typeof fetch;
    const worker = makeTranslationWorker(
      { TRANSLATION_PROVIDER: "google", GOOGLE_TRANSLATE_API_KEY: "k" },
      fetchFn,
    );
    const text = await worker({ text: "Hello", targetLanguage: "French" }, neverAborted());
    assert.equal(text, "Bonjour & bienvenue 'ami'");
  });

  it("Google without a key fails closed", async () => {
    const worker = makeTranslationWorker({ TRANSLATION_PROVIDER: "google" }, (async () => jsonResponse({})) as typeof fetch);
    await assert.rejects(worker({ text: "x", targetLanguage: "French" }, neverAborted()), /translation-provider-unconfigured/);
  });

  it("429 maps to a quota code instead of a generic failure", async () => {
    const worker = makeTranslationWorker(
      { TRANSLATION_PROVIDER: "google", GOOGLE_TRANSLATE_API_KEY: "k" },
      (async () => new Response("{}", { status: 429 })) as typeof fetch,
    );
    await assert.rejects(
      worker({ text: "x", targetLanguage: "French" }, neverAborted()),
      (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "QUOTA",
    );
  });

  it("unknown translation provider fails closed", async () => {
    const worker = makeTranslationWorker({ TRANSLATION_PROVIDER: "smoke-signals" }, (async () => jsonResponse({})) as typeof fetch);
    await assert.rejects(worker({ text: "x", targetLanguage: "French" }, neverAborted()), /translation-provider-unknown/);
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
