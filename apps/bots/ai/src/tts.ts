// Cyrene TTS wiring: /speak, /tts-voice, /tts-stop.
// Synthesis runs through @ei-point/module-tts queue (2 concurrent,
// bounded queue, 30s deadline). Voice playback joins the caller's voice
// channel via @discordjs/voice when available; otherwise the command fails
// clearly with staging guidance instead of claiming success.

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
    .setDescription("Speak text in your voice channel (Cyrene TTS)")
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName("text")
        .setDescription(`Text to speak (max ${TTS_MAX_CHARS} chars)`)
        .setMaxLength(TTS_MAX_CHARS)
        .setRequired(true),
    )
    .addStringOption((opt) => opt.setName("voice").setDescription("Voice name (per-guild default otherwise)")),
  new SlashCommandBuilder()
    .setName("tts-voice")
    .setDescription("View or set the TTS voice for this server")
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName("voice").setDescription("Voice name")),
  new SlashCommandBuilder()
    .setName("tts-stop")
    .setDescription("Stop TTS playback and leave voice")
    .setDMPermission(false),
];

function makeTtsProvider(): TtsSynthesizeFn {
  const apiUrl = process.env.TTS_PROVIDER_URL;
  const apiKey = process.env.TTS_PROVIDER_KEY;
  return async (text, voice, signal) => {
    if (apiUrl && apiKey) {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
  reply(text: string): Promise<void>;
  playAudio(audio: { mime: string; bytes: Uint8Array }): Promise<{ ok: true } | { ok: false; reason: string }>;
  stopPlayback(): Promise<void>;
}

export async function respondToTtsCommand(
  name: string,
  ctx: TtsCommandContext,
  pool: Pool,
): Promise<boolean> {
  if (name === "tts-voice") {
    if (ctx.requestedVoice) {
      const voice = normalizeVoice(ctx.requestedVoice);
      // Serialized version bump: advisory lock + insert in one transaction so
      // concurrent setters cannot compute the same MAX(version) + 1.
      // (Same pattern as the dashboard embed queue in control-routes.)
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `tts-voice:${ctx.guildId}`,
        ]);
        await client.query(
          `INSERT INTO config.settings (scope, key, version, value, updated_by)
           SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4
           FROM config.settings WHERE scope = $1 AND key = $2`,
          [`guild:${ctx.guildId}`, TTS_VOICE_KEY, JSON.stringify({ voice }), ctx.userId],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      await ctx.reply(`TTS voice set to **${voice}** for this server.`);
    } else {
      await ctx.reply(`Current TTS voice for this server: **${await getGuildVoice(pool, ctx.guildId)}**.`);
    }
    return true;
  }

  if (name === "tts-stop") {
    await ctx.stopPlayback();
    await ctx.reply("TTS playback stopped.");
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
    if (!ctx.inVoiceChannel) {
      await ctx.reply("Join a voice channel first, then use /speak.");
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
            : "TTS provider is not configured or unreachable. Staff: set TTS_PROVIDER_URL/KEY.",
      );
      return true;
    }
    const played = await ctx.playAudio(res.audio);
    if (!played.ok) {
      await ctx.reply(
        played.reason === "voice-unavailable"
          ? "Synthesis ready, but voice playback is unavailable on this host (staging gate). Audio was not played."
          : "Playback failed safely. Try again.",
      );
      return true;
    }
    await ctx.reply(`Spoke (${checked.text.length} chars, voice **${voice}**).`);
    return true;
  }

  return false;
}

export function ttsStatus() {
  return { inFlight: ttsQueue.inFlight(), queued: ttsQueue.queued() };
}
