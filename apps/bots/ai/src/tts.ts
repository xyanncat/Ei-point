// Cyrene TTS wiring: /speak, /tts, /leave, and /search.

import { SlashCommandBuilder } from "discord.js";
import type { Pool } from "pg";
import {
  createTtsQueue,
  normalizeVoice,
  validateTtsInput,
  TTS_MAX_CHARS,
  type TtsSynthesizeFn,
} from "@ei-point/module-tts";

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

const MAX_TTS_AUDIO_BYTES = 8 * 1024 * 1024;
const WAV_MIME_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);

function makeTtsProvider(): TtsSynthesizeFn {
  const apiUrl = process.env.QWEN_TTS_URL ?? "http://127.0.0.1:3120/v1/audio/speech";
  return async (text, voice, signal) => {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/wav" },
      body: JSON.stringify({ text, voice, format: "wav" }),
      signal,
    });
    if (res.status === 429) {
      const error = new Error("qwen-tts-queue-full");
      Object.assign(error, { code: "TTS_QUEUE_FULL" });
      throw error;
    }
    if (!res.ok) throw new Error(`qwen-tts-${res.status}`);
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!mime || !WAV_MIME_TYPES.has(mime)) throw new Error("qwen-tts-invalid-content-type");
    const contentLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_TTS_AUDIO_BYTES) {
      await res.body?.cancel();
      throw new Error("qwen-tts-audio-too-large");
    }
    if (!res.body) throw new Error("qwen-tts-empty-audio");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TTS_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error("qwen-tts-audio-too-large");
      }
      chunks.push(value);
    }
    if (size === 0) throw new Error("qwen-tts-empty-audio");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { mime: "audio/wav", bytes };
  };
}

const ttsQueue = createTtsQueue({
  provider: "qwen3-local",
  synthesize: makeTtsProvider(),
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
    await ctx.reply(started.ok ? "Cyrene joined. New messages in this voice channel's text chat will be read aloud; use `/leave` to stop." : started.reason === "already-active-elsewhere" ? "Cyrene is already reading a different voice channel in this server. Use `/leave` there before starting another session." : started.reason === "no-humans" ? "No members remain in that voice channel, so Cyrene left." : "Cyrene could not start the voice session. Check voice permissions and try again.");
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
    const voice = normalizeVoice(ctx.requestedVoice ?? (await getGuildVoice(pool, ctx.guildId)));
    const res = await ttsQueue.synthesize(checked.text, voice);
    if (!res.ok) {
      await ctx.reply(
        res.reason === "queue-full"
          ? "TTS service is at capacity. Try again shortly."
          : res.reason === "input-rejected"
            ? "That text was refused for safety."
          : "Cyrene's local TTS service is not ready. Try again after service health recovers.",
      );
      return true;
    }
    await ctx.sendAudio(res.audio);
    return true;
  }

  return false;
}

export function ttsStatus() {
  return { inFlight: ttsQueue.inFlight(), queued: ttsQueue.queued() };
}

export async function synthesizeSpeech(text: string, guildId: string, pool: Pool): Promise<{ mime: string; bytes: Uint8Array }> {
  const checked = validateTtsInput(text);
  if (!checked.ok) throw new Error("tts-input-rejected");
  const result = await ttsQueue.synthesize(checked.text, await getGuildVoice(pool, guildId));
  if (!result.ok) throw new Error(result.reason);
  return result.audio;
}
