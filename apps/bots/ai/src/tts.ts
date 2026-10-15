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
    .setDescription("Search the configured Cyrene search source")
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true).setMaxLength(300)),
];

function makeTtsProvider(): TtsSynthesizeFn {
  const apiUrl = process.env.TTS_PROVIDER_URL;
  const apiKey = process.env.TTS_PROVIDER_KEY;
  return async (text, voice, signal) => {
    if (apiUrl) {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ text, voice, format: "mp3" }),
        signal,
      });
      if (!res.ok) throw new Error(`tts-provider-${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("tts-empty-audio");
      return { mime: "audio/mpeg", bytes: buf };
    }
    throw new Error("tts-provider-not-configured");
  };
}

const ttsQueue = createTtsQueue({
  provider: process.env.TTS_PROVIDER_NAME ?? "default",
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
    await ctx.reply(await ctx.search(ctx.query ?? ""));
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
