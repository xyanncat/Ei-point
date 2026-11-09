// Cyrene TTS wiring: /speak, /tts, /leave, and /search.
//
// Provider selection (redesign infrastructure §6). The queue, caps, caching
// key and error contract are unchanged; only "who synthesizes" moves.
//   TTS_PROVIDER unset/empty/local -> POST TTS_URL {text,voice,format} -> WAV (Piper bridge on the phone)
//   TTS_PROVIDER=google            -> Google Cloud Text-to-Speech -> MP3
//   TTS_PROVIDER=openai            -> OpenAI-compatible /v1/audio/speech -> audio bytes
// Remote providers never fall back to a local model silently; a failure is a
// typed failure and the user gets a text answer, not a surprise process start.

import { SlashCommandBuilder } from "discord.js";
import type { Pool } from "pg";
import {
  createTtsQueue,
  normalizeVoice,
  validateTtsInput,
  TTS_DEADLINE_MS,
  TTS_MAX_CHARS,
  type TtsSynthesizeFn,
} from "@ei-point/module-tts";
import { createFailureGate, fetchWithBoundedRetry, readBoundedBody } from "./http.js";
import { releaseUnitReservation, reserveUnitBudget, settleUnitUsage } from "./budget.js";

export const ttsCommandDefinitions = [
  new SlashCommandBuilder()
    .setName("speak")
    .setDescription("Create and attach a Cyrene voice file")
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName("text")
        .setDescription(`Text to speak (max ${TTS_MAX_CHARS} chars)`)
        .setMaxLength(TTS_MAX_CHARS)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("tts")
    .setDescription("Read this voice channel's text chat aloud")
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the active Cyrene voice session")
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Ask Cyrene a question (AI answer, no web search)")
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true).setMaxLength(300)),
];

export const MAX_TTS_AUDIO_BYTES = 8 * 1024 * 1024;
const WAV_MIME_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
// Formats a compressed provider may return; ffmpeg in the voice path decodes
// them, and the bounded byte check applies identically.
const PROVIDER_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/opus",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "application/octet-stream",
]);

/** One synthesis budget, queue wait included, capped at the module maximum. */
export function ttsTotalDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TTS_TOTAL_DEADLINE_SECONDS?.trim();
  if (!raw) return TTS_DEADLINE_MS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return TTS_DEADLINE_MS;
  return Math.min(Math.round(seconds * 1000), TTS_DEADLINE_MS);
}

function makeLocalTtsProvider(env: NodeJS.ProcessEnv, fetchFn: typeof fetch): TtsSynthesizeFn {
  const apiUrl = env.TTS_URL ?? "http://127.0.0.1:3120/v1/audio/speech";
  return async (text, voice, signal) => {
    const res = await fetchFn(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/wav" },
      body: JSON.stringify({ text, voice, format: "wav" }),
      signal,
    });
    if (res.status === 429) {
      const error = new Error("local-tts-queue-full");
      Object.assign(error, { code: "TTS_QUEUE_FULL" });
      throw error;
    }
    if (!res.ok) throw new Error(`tts-${res.status}`);
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!mime || !WAV_MIME_TYPES.has(mime)) throw new Error("tts-invalid-content-type");
    const contentLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_TTS_AUDIO_BYTES) {
      await res.body?.cancel();
      throw new Error("tts-audio-too-large");
    }
    if (!res.body) throw new Error("tts-empty-audio");
    const bytes = await readBoundedBody(res.body, MAX_TTS_AUDIO_BYTES, "tts-audio-too-large");
    if (bytes.byteLength === 0) throw new Error("tts-empty-audio");
    return { mime: "audio/wav", bytes };
  };
}

/** Default voice for Google when the deployment does not set one. */
export const GOOGLE_DEFAULT_VOICE = "en-US-Standard-C";

/** `en-US-Chirp3-HD-Aoede` -> `en-US`; a bare locale passes through. */
export function googleLanguageCode(voice: string): string {
  const parts = voice.split("-");
  if (parts.length >= 2 && parts[0]!.length === 2) return `${parts[0]}-${parts[1]}`;
  return "en-US";
}

function makeGoogleTtsProvider(env: NodeJS.ProcessEnv, fetchFn: typeof fetch): TtsSynthesizeFn {
  const apiKey = env.GOOGLE_TTS_API_KEY?.trim() ?? "";
  const voiceName = env.GOOGLE_TTS_VOICE?.trim() || GOOGLE_DEFAULT_VOICE;
  const gate = createFailureGate();
  if (!apiKey) {
    // Configured without a key is an operator error, not a user error: fail
    // closed with a clear code, never fall back to the local process.
    return async () => {
      throw Object.assign(new Error("tts-provider-unconfigured"), { code: "TTS_UNCONFIGURED" });
    };
  }
  return async (text, _voice, signal) => {
    if (!gate.allow()) throw new Error("tts-provider-circuit-open");
    let res: Response;
    try {
      res = await fetchWithBoundedRetry(
        fetchFn,
        "https://texttospeech.googleapis.com/v1/text:synthesize",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            // Header keeps the key out of URLs, which survive in logs.
            "X-Goog-Api-Key": apiKey,
          },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: googleLanguageCode(voiceName), name: voiceName },
            audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
          }),
          signal,
        },
        { retryDelayMs: 750 },
      );
    } catch (error) {
      gate.fail();
      throw error;
    }
    if (res.status === 429) {
      gate.fail();
      throw Object.assign(new Error("tts-quota-exhausted"), { code: "TTS_QUOTA" });
    }
    if (!res.ok) {
      gate.fail();
      throw new Error(`tts-${res.status}`);
    }
    if (!res.body) {
      gate.fail();
      throw new Error("tts-empty-audio");
    }
    let payload: { audioContent?: unknown };
    try {
      const bytes = await readBoundedBody(res.body, 12 * 1024 * 1024, "tts-audio-too-large");
      payload = JSON.parse(new TextDecoder().decode(bytes)) as { audioContent?: unknown };
    } catch (error) {
      gate.fail();
      throw error;
    }
    if (typeof payload.audioContent !== "string" || payload.audioContent.length === 0) {
      gate.fail();
      throw new Error("tts-empty-audio");
    }
    // Base64 inflates by ~4/3; check before decoding so a hostile/unbounded
    // response cannot allocate past the audio bound.
    if (payload.audioContent.length > Math.ceil((MAX_TTS_AUDIO_BYTES * 4) / 3) + 4) {
      gate.fail();
      throw new Error("tts-audio-too-large");
    }
    const audio = Buffer.from(payload.audioContent, "base64");
    if (audio.byteLength === 0) {
      gate.fail();
      throw new Error("tts-empty-audio");
    }
    if (audio.byteLength > MAX_TTS_AUDIO_BYTES) {
      gate.fail();
      throw new Error("tts-audio-too-large");
    }
    gate.ok();
    return { mime: "audio/mpeg", bytes: new Uint8Array(audio) };
  };
}

function makeOpenAiTtsProvider(env: NodeJS.ProcessEnv, fetchFn: typeof fetch): TtsSynthesizeFn {
  const defaultUrl = "https://api.openai.com/v1/audio/speech";
  const apiUrl = env.TTS_PROVIDER_URL?.trim() || defaultUrl;
  const apiKey = env.TTS_PROVIDER_KEY?.trim() ?? "";
  const model = env.TTS_PROVIDER_MODEL?.trim() || "tts-1";
  const gate = createFailureGate();
  return async (text, voice, signal) => {
    if (!gate.allow()) throw new Error("tts-provider-circuit-open");
    let res: Response;
    try {
      res = await fetchWithBoundedRetry(
        fetchFn,
        apiUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "audio/mpeg, audio/wav, audio/ogg",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model, input: text, voice: normalizeVoice(voice), response_format: "mp3" }),
          signal,
        },
        { retryDelayMs: 750 },
      );
    } catch (error) {
      gate.fail();
      throw error;
    }
    if (res.status === 429) {
      gate.fail();
      throw Object.assign(new Error("tts-quota-exhausted"), { code: "TTS_QUOTA" });
    }
    if (res.status === 404) {
      // Wrong URL is an operator error, not an outage; keep it loud and distinct.
      throw new Error("tts-provider-not-found");
    }
    if (!res.ok) {
      gate.fail();
      throw new Error(`tts-${res.status}`);
    }
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!res.body) {
      gate.fail();
      throw new Error("tts-empty-audio");
    }
    const contentLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_TTS_AUDIO_BYTES) {
      await res.body.cancel().catch(() => {});
      gate.fail();
      throw new Error("tts-audio-too-large");
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(res.body, MAX_TTS_AUDIO_BYTES, "tts-audio-too-large");
    } catch (error) {
      gate.fail();
      throw error;
    }
    if (bytes.byteLength === 0) {
      gate.fail();
      throw new Error("tts-empty-audio");
    }
    gate.ok();
    // Trust the header only when it names a known audio type; otherwise the
    // bytes still went through the bounded read and ffmpeg will sniff them.
    const resolved = PROVIDER_MIME_TYPES.has(mime) && mime !== "application/octet-stream" ? mime : "audio/mpeg";
    return { mime: resolved as "audio/mpeg" | "audio/ogg" | "audio/wav", bytes };
  };
}

/** Resolve the configured provider; local unless explicitly moved (fail closed). */
export function makeTtsProvider(env: NodeJS.ProcessEnv = process.env, fetchFn: typeof fetch = fetch): TtsSynthesizeFn {
  const provider = (env.TTS_PROVIDER ?? "local").trim().toLowerCase();
  if (provider === "" || provider === "local") return makeLocalTtsProvider(env, fetchFn);
  if (provider === "google") return makeGoogleTtsProvider(env, fetchFn);
  if (provider === "openai") return makeOpenAiTtsProvider(env, fetchFn);
  return async () => {
    throw Object.assign(new Error("tts-provider-unknown"), { code: "TTS_UNCONFIGURED" });
  };
}

/** Provider name used in cache keys and status; never in user-facing copy. */
export function ttsProviderName(env: NodeJS.ProcessEnv = process.env): string {
  const provider = (env.TTS_PROVIDER ?? "local").trim().toLowerCase();
  if (provider === "" || provider === "local") return "local-tts";
  if (provider === "google") return "google-tts";
  if (provider === "openai") return "openai-tts";
  return "unconfigured";
}

const ttsQueue = createTtsQueue({
  provider: ttsProviderName(),
  synthesize: makeTtsProvider(),
  deadlineMs: ttsTotalDeadlineMs(),
});

const TTS_VOICE_KEY = "tts.voice";

export async function getGuildVoice(pool: Pool, guildId: string): Promise<string> {
  const res = await pool.query<{ value: unknown }>(
    "SELECT value FROM config.settings WHERE scope = $1 AND key = $2 ORDER BY version DESC LIMIT 1",
    [`guild:${guildId}`, TTS_VOICE_KEY],
  );
  const v = (res.rows[0]?.value as { voice?: unknown } | null)?.voice;
  return normalizeVoice(typeof v === "string" ? v : "default");
}

export interface TtsCommandContext {
  guildId: string;
  userId: string;
  inVoiceChannel: boolean;
  requestedVoice?: string | undefined;
  text?: string | undefined;
  query?: string | undefined;
  reply(text: string): Promise<void>;
  sendAudio(audio: { mime: string; bytes: Uint8Array }): Promise<void>;
  startTts(): Promise<{ ok: true } | { ok: false; reason: string }>;
  playAudio(audio: { mime: string; bytes: Uint8Array }): Promise<{ ok: true } | { ok: false; reason: string }>;
  stopPlayback(): Promise<void>;
  search(query: string): Promise<string>;
}

export async function respondToTtsCommand(
  name: string,
  ctx: TtsCommandContext,
  pool: Pool,
): Promise<boolean> {
  if (name === "leave") {
    await ctx.stopPlayback();
    await ctx.reply("Cyrene left the voice channel.");
    return true;
  }

  if (name === "tts") {
    if (!ctx.inVoiceChannel) {
      await ctx.reply("Join a voice channel first, then use `/tts`.");
      return true;
    }
    const started = await ctx.startTts();
    const failures: Record<string, string> = {
      "already-active-elsewhere": "Cyrene is already reading a different voice channel in this server. Use `/leave` there before starting another session.",
      "no-humans": "No members remain in that voice channel, so Cyrene left.",
      "voice-full": "Cyrene's voice sessions are at capacity. Wait for a session to finish and try again.",
      "missing-permissions": "Cyrene needs View Channel, Connect, and Speak permissions in your voice channel.",
      "stage-channel": "Use a regular voice channel for Cyrene text reading. Stage channels are not supported.",
    };
    await ctx.reply(started.ok
      ? "Cyrene joined. New messages in this voice channel's text chat will be read aloud; use `/leave` to stop."
      : failures[started.reason] ?? "Cyrene could not establish a voice connection. Check the bot logs for the connection error and verify outbound Discord voice/UDP access.");
    return true;
  }

  if (name === "search") {
    const query = ctx.query ?? "";
    if (!query.trim()) {
      await ctx.reply("Give me a question to answer.");
      return true;
    }
    await ctx.reply(await ctx.search(query));
    return true;
  }

  if (name === "speak") {
    const checked = validateTtsInput(ctx.text ?? "");
    if (!checked.ok) {
      const why =
        checked.reason === "empty"
          ? "Give me text to speak."
          : checked.reason.startsWith("over-limit")
            ? `Text too long (max ${TTS_MAX_CHARS} chars).`
            : "That text was refused for safety.";
      await ctx.reply(why);
      return true;
    }
    // Admit the character cost before spending it — same PostgreSQL
    // reservation machinery the chat budget uses (redesign infra §6).
    const admitted = await reserveUnitBudget(pool, {
      guildId: ctx.guildId,
      userId: ctx.userId,
      kind: "tts",
      units: checked.text.length,
      providerPattern: "tts:%",
    });
    if (!admitted.ok) {
      await ctx.reply(admitted.message);
      return true;
    }
    const voice = normalizeVoice(ctx.requestedVoice ?? (await getGuildVoice(pool, ctx.guildId)));
    const res = await ttsQueue.synthesize(checked.text, voice);
    if (!res.ok) {
      await releaseUnitReservation(pool, admitted.reservation);
      await ctx.reply(
        res.reason === "queue-full"
          ? "TTS service is at capacity. Try again shortly."
          : res.reason === "input-rejected"
            ? "That text was refused for safety."
            : ttsProviderName() === "local-tts"
              ? "Cyrene's local TTS service is not ready. Try again after service health recovers."
              : "Cyrene's voice service is temporarily unavailable. Please try again shortly.",
      );
      return true;
    }
    try {
      await settleUnitUsage(pool, {
        reservation: admitted.reservation,
        guildId: ctx.guildId,
        userId: ctx.userId,
        provider: `tts:${ttsProviderName()}`,
        units: checked.text.length,
      });
    } catch {
      // Audio succeeded; an accounting error must not block delivery.
    }
    await ctx.sendAudio(res.audio);
    return true;
  }

  return false;
}

export function ttsStatus() {
  return {
    inFlight: ttsQueue.inFlight(),
    queued: ttsQueue.queued(),
    provider: ttsProviderName(),
    local: ttsProviderName() === "local-tts",
  };
}

export async function synthesizeSpeech(text: string, guildId: string, pool: Pool): Promise<{ mime: string; bytes: Uint8Array }> {
  const checked = validateTtsInput(text);
  if (!checked.ok) throw new Error("tts-input-rejected");
  const result = await ttsQueue.synthesize(checked.text, await getGuildVoice(pool, guildId));
  if (!result.ok) throw new Error(result.reason);
  return result.audio;
}
