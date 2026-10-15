// TTS module: Cyrene voice TTS playback (pure logic, no Discord/voice imports).
// Provider-agnostic: synthesis fn is injected by the bot entrypoint.
// Budgets mirror §5 voice envelope: 2 concurrent syntheses, bounded queue,
// 90s synthesis deadline, 500-char input cap, 2 concurrent voice sessions.

import { createHash } from "node:crypto";

export const TTS_CONCURRENT = 2;
export const TTS_QUEUE_MAX = 10;
export const TTS_DEADLINE_MS = 90_000;
export const TTS_MAX_CHARS = 500;
export const TTS_MAX_SESSIONS = 2;
export const TTS_CACHE_VERSION = 1;

export type TtsProviderFailure = "queue-full" | "all-failed" | "input-rejected";

export interface TtsAudio {
  mime: "audio/mpeg" | "audio/ogg" | "audio/wav";
  bytes: Uint8Array;
  sampleRate?: number;
}

export type TtsSynthesizeFn = (
  text: string,
  voice: string,
  signal: AbortSignal,
) => Promise<TtsAudio>;

export function validateTtsInput(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > TTS_MAX_CHARS)
    return { ok: false, reason: `over-limit:${TTS_MAX_CHARS}` };
  // Refuse likely credential dumps before they reach logs/provider.
  if (/mfa\.[\w-]{10,}|ghp_[A-Za-z0-9]{36}|BEGIN [A-Z ]*PRIVATE KEY/.test(trimmed))
    return { ok: false, reason: "secret-rejected" };
  return { ok: true, text: trimmed };
}

/**
 * Voice-chat reader filter: keep only speakable words. Drops markdown
 * links/images and bare links entirely, plus custom (`<:name:id>`) and
 * unicode emoji. Stickers, attachments and GIFs never reach this function —
 * the caller skips non-text message parts. Empty result means stay silent.
 */
export function extractVoiceChatText(
  content: string,
): { ok: true; text: string } | { ok: false; reason: "nothing-speakable" } {
  const cleaned = content
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(
      /<a?:\w+:\d+>|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return { ok: false, reason: "nothing-speakable" };
  return { ok: true, text: cleaned };
}

export function normalizeVoice(voice: string | null | undefined): string {
  const v = (voice ?? "default").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return v === "" ? "default" : v.slice(0, 40);
}

/** Stable cache key: (version, provider, voice, sha256(text)). Never embeds raw text. */
export function ttsCacheKey(provider: string, voice: string, text: string): string {
  const digest = createHash("sha256").update(text, "utf8").digest("hex");
  const safeProvider = provider.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "default";
  return `v${TTS_CACHE_VERSION}/${safeProvider}/${normalizeVoice(voice)}/${digest}`;
}

export function createTtsQueue(opts: {
  synthesize: TtsSynthesizeFn;
  provider: string;
  deadlineMs?: number;
}): {
  synthesize: (text: string, voice: string) => Promise<{ ok: true; audio: TtsAudio; cacheKey: string } | { ok: false; reason: TtsProviderFailure }>;
  inFlight: () => number;
  queued: () => number;
} {
  const deadlineMs = opts.deadlineMs ?? TTS_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > TTS_DEADLINE_MS) throw new Error("Invalid TTS deadline");
  let active = 0;
  const waiting: Array<() => void> = [];

  async function run(text: string, voice: string): Promise<TtsAudio> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_,reject) => {
      timer=setTimeout(()=>{controller.abort();reject(new Error("deadline-exceeded"));},deadlineMs);
    });
    try {
      return await Promise.race([opts.synthesize(text, voice, controller.signal),timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  async function synthesize(text: string, voice: string) {
    const validated = validateTtsInput(text);
    if (!validated.ok) return { ok: false as const, reason: "input-rejected" as const };
    if (active >= TTS_CONCURRENT && waiting.length >= TTS_QUEUE_MAX) {
      return { ok: false as const, reason: "queue-full" as const };
    }
    if (active >= TTS_CONCURRENT) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      const audio = await run(validated.text, normalizeVoice(voice));
      return { ok: true as const, audio, cacheKey: ttsCacheKey(opts.provider, voice, validated.text) };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "TTS_QUEUE_FULL") {
        return { ok: false as const, reason: "queue-full" as const };
      }
      return { ok: false as const, reason: "all-failed" as const };
    } finally {
      active--;
      const next = waiting.shift();
      if (next != null) next();
    }
  }

  return { synthesize, inFlight: () => active, queued: () => waiting.length };
}
