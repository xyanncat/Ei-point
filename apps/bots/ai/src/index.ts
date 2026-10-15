import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { acquireVoiceLease } from "./voice-lease.js";
import { isControlEnabled } from "@ei-point/flow";
import { createServer } from "node:http";
import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
  Routes,
} from "discord.js";
import pg from "pg";
import { commonCommandDefinitions, respondToCommonCommand, toEiEmbedPayload, withEiEmbedReplies } from "@ei-point/module-bot-ui";
import {
  createRouter,
  makeHttpProvider,
} from "@ei-point/module-ai";
import { Readable } from "node:stream";
import {
  aiCommandDefinitions,
  respondToAiCommand,
  processConversation,
} from "./commands.js";
import { synthesizeSpeech, ttsCommandDefinitions, respondToTtsCommand } from "./tts.js";
import { extractVoiceChatText, TTS_MAX_CHARS } from "@ei-point/module-tts";
import { respondToTranslationCommand, translationCommandDefinition } from "./translate.js";
import { prepareCyrenePersonaPrompt } from "./persona.js";

const ALL_AI_COMMANDS = [...commonCommandDefinitions(), ...ttsCommandDefinitions, translationCommandDefinition];
const TTS_NAMES = new Set(ttsCommandDefinitions.map((c) => c.name));
const TRANSLATION_NAME = translationCommandDefinition.name;

// Cyrene voice sessions: guildId -> voice connection (lazy @discordjs/voice).
const voiceSessions = new Map<string, { destroy: () => void }>();
const pendingVoice = new Set<string>();
type CyreneVoiceSession = {
  channelId: string;
  guildId: string;
  connection: import("@discordjs/voice").VoiceConnection;
  player: import("@discordjs/voice").AudioPlayer;
  queue: string[];
  busy: boolean;
  owner: string;
  leaseTimer: ReturnType<typeof setInterval>;
};
const cyreneVoiceSessions = new Map<string, CyreneVoiceSession>();

async function stopCyreneSession(guildId: string): Promise<void> {
  const session = cyreneVoiceSessions.get(guildId);
  if (!session) return;
  cyreneVoiceSessions.delete(guildId);
  session.queue.length = 0;
  clearInterval(session.leaseTimer);
  try { session.player.stop(true); session.connection.destroy(); } catch { /* already disconnected */ }
  voiceSessions.delete(guildId);
  await pool.query("DELETE FROM ai.voice_leases WHERE owner=$1", [session.owner]).catch(() => {
    console.error("cyrene voice lease cleanup deferred until reconciliation");
  });
}

async function drainCyreneQueue(session: CyreneVoiceSession): Promise<void> {
  if (session.busy || cyreneVoiceSessions.get(session.guildId) !== session) return;
  session.busy = true;
  try {
    while (session.queue.length && cyreneVoiceSessions.get(session.guildId) === session) {
      const text = session.queue.shift()!;
      try {
        const audio = await synthesizeSpeech(text, session.guildId, pool);
        if (cyreneVoiceSessions.get(session.guildId) !== session) return;
        const voice = await import("@discordjs/voice");
        session.player.play(voice.createAudioResource(Readable.from(Buffer.from(audio.bytes)), { inputType: voice.StreamType.Arbitrary }));
        await voice.entersState(session.player, voice.AudioPlayerStatus.Idle, 120_000);
      } catch (err) {
        console.error("cyrene voice chat message was not spoken:", err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    session.busy = false;
  }
}

async function startCyreneSession(guildId: string, voiceChannelId: string, adapterCreator: unknown): Promise<{ ok: true } | { ok: false; reason: string }> {
  const currentSession = cyreneVoiceSessions.get(guildId);
  if (currentSession) return currentSession.channelId === voiceChannelId ? { ok: true } : { ok: false, reason: "already-active-elsewhere" };
  if (pendingVoice.has(guildId)) return { ok: false, reason: "voice-full" };
  pendingVoice.add(guildId);
  const owner = `tts-session:${guildId}:${randomUUID()}`;
  let connection: import("@discordjs/voice").VoiceConnection | undefined;
  try {
    if (!(await acquireVoiceLease(pool, owner))) return { ok: false, reason: "voice-full" };
    if (voiceSessions.size >= 2 && !voiceSessions.has(guildId)) {
      await pool.query("DELETE FROM ai.voice_leases WHERE owner=$1", [owner]);
      return { ok: false, reason: "voice-full" };
    }
    const voice = await import("@discordjs/voice");
    connection = voice.joinVoiceChannel({ channelId: voiceChannelId, guildId, adapterCreator: adapterCreator as never });
    await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 15_000);
    const player = voice.createAudioPlayer();
    connection.subscribe(player);
    const leaseTimer = setInterval(() => {
      void pool.query("UPDATE ai.voice_leases SET expires_at=now()+interval '60 seconds' WHERE owner=$1", [owner]).then((result) => {
        if (result.rowCount !== 1 && cyreneVoiceSessions.get(guildId)?.owner === owner) void stopCyreneSession(guildId);
      }).catch(() => {
        console.error("cyrene voice lease renewal failed");
        if (cyreneVoiceSessions.get(guildId)?.owner === owner) void stopCyreneSession(guildId);
      });
    }, 20_000);
    leaseTimer.unref();
    const session: CyreneVoiceSession = { channelId: voiceChannelId, guildId, connection, player, queue: [], busy: false, owner, leaseTimer };
    cyreneVoiceSessions.set(guildId, session);
    voiceSessions.set(guildId, connection);
    connection.on("stateChange", (_oldState, newState) => {
      if (newState.status === voice.VoiceConnectionStatus.Destroyed) {
        void stopCyreneSession(guildId);
      } else if (newState.status === voice.VoiceConnectionStatus.Disconnected) {
        const recoveryTimer = setTimeout(() => {
          if (connection?.state.status === voice.VoiceConnectionStatus.Disconnected) void stopCyreneSession(guildId);
        }, 15_000);
        recoveryTimer.unref();
      }
    });
    const voiceChannel = client.channels.cache.get(voiceChannelId);
    if (!voiceChannel?.isVoiceBased() || !voiceChannel.members.some((member) => !member.user.bot)) {
      await stopCyreneSession(guildId);
      return { ok: false, reason: "no-humans" };
    }
    return { ok: true };
  } catch {
    const session = cyreneVoiceSessions.get(guildId);
    if (session?.connection === connection) {
      await stopCyreneSession(guildId);
    } else {
      if (voiceSessions.get(guildId) === connection) voiceSessions.delete(guildId);
      connection?.destroy();
      await pool.query("DELETE FROM ai.voice_leases WHERE owner=$1", [owner]).catch(() => {
        console.error("cyrene voice lease cleanup deferred until reconciliation");
      });
    }
    return { ok: false, reason: "voice-unavailable" };
  } finally {
    pendingVoice.delete(guildId);
  }
}

async function playTtsAudio(
  guildId: string,
  channelId: string,
  voiceAdapterCreator: unknown,
  audio: { mime: string; bytes: Uint8Array },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (pendingVoice.has(guildId)) return { ok: false, reason: "voice-full" };
  pendingVoice.add(guildId);
  const owner = `tts:${guildId}:${randomUUID()}`;
  let connection: { destroy(): void } | undefined;
  try {
    if (!(await acquireVoiceLease(pool, owner))) return { ok: false, reason: "voice-full" };
    const voice = await import("@discordjs/voice");
    if (voiceSessions.size >= 2 && !voiceSessions.has(guildId)) {
      return { ok: false, reason: "voice-full" };
    }
    connection = voice.joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: voiceAdapterCreator as never,
    });
    voiceSessions.set(guildId, connection);
    const resource = voice.createAudioResource(Readable.from(Buffer.from(audio.bytes)), {
      inputType: voice.StreamType.Arbitrary,
    });
    const player = voice.createAudioPlayer();
    (connection as import("@discordjs/voice").VoiceConnection).subscribe(player);
    player.play(resource);
    await voice.entersState(player, voice.AudioPlayerStatus.Idle, 30_000);
    return { ok: true };
  } catch (err) {
    if (
      err instanceof Error &&
      /Cannot find (package|module)/.test(err.message)
    ) {
      return { ok: false, reason: "voice-unavailable" };
    }
    return { ok: false, reason: "play-failed" };
  } finally {
    try { connection?.destroy(); } catch { /* Already stopped by /tts-stop. */ }
    voiceSessions.delete(guildId);
    pendingVoice.delete(guildId);
    await pool.query("DELETE FROM ai.voice_leases WHERE owner=$1", [owner]);
  }
}

const botKey = process.env.BOT_KEY ?? "cyrene";
const url = process.env.DATABASE_URL;
const token = process.env.BOT_TOKEN ?? process.env.DISCORD_CYRENE_BOT_TOKEN ?? process.env.DISCORD_AI_BOT_TOKEN;
const rawAllowlist =
  process.env.GUILD_ALLOWLIST ??
  process.env.COMMUNITY_GUILD_ALLOWLIST ??
  [process.env.DISCORD_TEST_GUILD_ID, process.env.DISCORD_MAIN_GUILD_ID].filter(Boolean).join(",");
const allowed = rawAllowlist
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

if (!url || !token || allowed.length !== 2 || allowed.some((x) => !/^\d{17,20}$/.test(x))) {
  throw new Error("Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST (exactly two guild IDs) before starting the AI bot.");
}

const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  application_name: "bot-ai",
});
pool.on("error", () => console.error("ai database connection interrupted"));
process.on("unhandledRejection", (err) => console.error("unhandledRejection in bot-ai:", err));

// Daily token cap per user (default 25,000 tokens). Invalid values fail closed.
const DAILY_BUDGET_RAW = Number(process.env.AI_DAILY_BUDGET_TOKENS ?? 25000);
if (!Number.isFinite(DAILY_BUDGET_RAW) || DAILY_BUDGET_RAW <= 0) {
  throw new Error("AI_DAILY_BUDGET_TOKENS must be a positive finite number.");
}
const DAILY_BUDGET_CAP = DAILY_BUDGET_RAW;

// Discord message limit: truncate provider text instead of failing delivery.
function fitDiscord(text: string, limit = 2000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1) + "…";
}

if (!process.env.AI_PROVIDER_PRIMARY || !process.env.AI_PROVIDER_PRIMARY_MODEL?.trim()) throw new Error("AI_PROVIDER_PRIMARY and AI_PROVIDER_PRIMARY_MODEL are required");
if ([process.env.AI_PROVIDER_FALLBACK, process.env.AI_PROVIDER_FALLBACK_KEY, process.env.AI_PROVIDER_FALLBACK_MODEL].some(Boolean) && (!process.env.AI_PROVIDER_FALLBACK || !process.env.AI_PROVIDER_FALLBACK_MODEL?.trim())) throw new Error("Fallback provider URL and model must be configured together; its key is optional for local endpoints");
const primaryProvider = makeHttpProvider(
  process.env.AI_PROVIDER_PRIMARY,
  process.env.AI_PROVIDER_PRIMARY_KEY,
  fetch,
  process.env.AI_PROVIDER_PRIMARY_MODEL,
);
const fallbackProvider = makeHttpProvider(
  process.env.AI_PROVIDER_FALLBACK,
  process.env.AI_PROVIDER_FALLBACK_KEY,
  fetch,
  process.env.AI_PROVIDER_FALLBACK_MODEL,
);

const router = createRouter({
  primary: primaryProvider,
  fallback: fallbackProvider,
  deadlineMs: Number(process.env.AI_DEADLINE_MS ?? 60000),
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  makeCache: Options.cacheWithLimits({ MessageManager: 20 }),
});

let stopping = false;
let identityVerified = false;
let lastDbReady = false;
let activeCommands = 0;
let cyrenePersona = "";
const cyrenePersonaPath = process.env.CYRENE_PERSONA_MEMORY_PATH ?? ".models/Cyrene_Chat_Roleplay_Memory.md";

async function loadCyrenePersona(): Promise<string> {
  const info = await stat(cyrenePersonaPath);
  if (!info.isFile() || info.size < 1 || info.size > 32 * 1024) {
    throw new Error("Cyrene persona memory must be a non-empty regular file no larger than 32 KiB");
  }
  const memory = (await readFile(cyrenePersonaPath, "utf8")).trim();
  if (!memory || Buffer.byteLength(memory, "utf8") > 32 * 1024) throw new Error("Cyrene persona memory is empty or too large");
  return prepareCyrenePersonaPrompt(memory);
}

const guarded = (label: string, run: () => Promise<unknown>) => {
  void run().catch((err) =>
    console.error(`ai ${label} failed:`, err instanceof Error ? err.message : String(err)),
  );
};

// --- Handle Direct Mentions in Channels ---
const userMentionCooldown = new Map<string, number>();
const voiceChatCooldown = new Map<string, number>();
const voiceChatPending = new Set<string>();

client.on(Events.MessageCreate, async (message) => {
  const session = message.guildId ? cyreneVoiceSessions.get(message.guildId) : undefined;
  if (!session || message.channelId !== session.channelId || message.author.bot || !message.guild) return;
  if (message.content.length > TTS_MAX_CHARS) {
    void message.reply(toEiEmbedPayload(`I skipped that message because voice chat messages must be ${TTS_MAX_CHARS} characters or shorter.`, "Cyrene")).catch(() => {});
    return;
  }
  const extracted = extractVoiceChatText(message.content);
  if (!extracted.ok) return;
  const spoken = extracted.text;
  const cooldownKey = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const lastSpokenAt = voiceChatCooldown.get(cooldownKey) ?? 0;
  if (now - lastSpokenAt < 5_000 || voiceChatPending.has(cooldownKey)) {
    void message.reply(toEiEmbedPayload("Please wait a few seconds before sending another message for voice playback.", "Cyrene")).catch(() => {});
    return;
  }
  voiceChatPending.add(cooldownKey);
  try {
    const enabled = await isControlEnabled(
      async (sql, params) => (await pool.query(sql, params)).rows,
      message.guildId!,
      botKey,
      "tts",
      message.member ? [...message.member.roles.cache.keys()] : [],
    );
    if (!enabled) {
      void message.reply(toEiEmbedPayload("Voice chat reading is disabled or restricted by this server's Ei-Flow controls.", "Cyrene")).catch(() => {});
      return;
    }
    if (cyreneVoiceSessions.get(message.guildId!) !== session) return;
    if (session.queue.length >= 10) {
      void message.reply(toEiEmbedPayload("My voice queue is full. Please wait for a few messages to finish.", "Cyrene")).catch(() => {});
      return;
    }
    session.queue.push(spoken);
    voiceChatCooldown.set(cooldownKey, Date.now());
  } catch (err) {
    console.error("cyrene voice chat authorization failed:", err instanceof Error ? err.message : String(err));
    return;
  } finally {
    voiceChatPending.delete(cooldownKey);
  }
  if (voiceChatCooldown.size > 500) {
    const cutoff = now - 60_000;
    for (const [key, ts] of voiceChatCooldown.entries()) if (ts < cutoff) voiceChatCooldown.delete(key);
  }
  void drainCyreneQueue(session);
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const session = cyreneVoiceSessions.get(newState.guild.id);
  if (!session || (oldState.channelId !== session.channelId && newState.channelId !== session.channelId)) return;
  if (newState.id === client.user?.id && newState.channelId !== session.channelId) {
    void stopCyreneSession(newState.guild.id);
    return;
  }
  const channel = newState.guild.channels.cache.get(session.channelId);
  if (!channel?.isVoiceBased()) {
    void stopCyreneSession(newState.guild.id);
    return;
  }
  const humans = channel.members.filter((member) => !member.user.bot && (member.id !== newState.id || newState.channelId === session.channelId));
  if (humans.size === 0) void stopCyreneSession(newState.guild.id);
});

client.on(Events.MessageCreate, (message) => {
  if (
    !identityVerified ||
    !message.guildId ||
    !allowed.includes(message.guildId) ||
    message.author.bot ||
    !client.user ||
    !message.mentions.has(client.user)
  )
    return;

  guarded("mention-reply", async () => {
    if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows, message.guildId!, botKey, "ask", message.member ? [...message.member.roles.cache.keys()] : []))) return;
    const last = userMentionCooldown.get(message.author.id) ?? 0;
    if (Date.now() - last < 5000) {
      await message.reply(toEiEmbedPayload("Please wait a few seconds before asking another question.", "Cyrene"));
      return;
    }
    userMentionCooldown.set(message.author.id, Date.now());
    if (userMentionCooldown.size > 200) {
      const cutoff = Date.now() - 30000;
      for (const [uid, ts] of userMentionCooldown.entries()) {
        if (ts < cutoff) userMentionCooldown.delete(uid);
      }
    }

    const rawContent = message.content.replace(new RegExp(`<@!?${client.user!.id}>`, "g"), "").trim();
    if (!rawContent) {
      await message.reply(toEiEmbedPayload("Ah, there you are! Hehe, were you looking for me? You can ask me anything by mentioning me here.", "Cyrene"));
      return;
    }

    await message.channel.sendTyping().catch(() => {});

    const reply = await processConversation(
      pool,
      message.guildId!,
      message.author.id,
      "default",
      rawContent,
      (p) => router.ask(p),
      DAILY_BUDGET_CAP,
      cyrenePersona,
    );

    await message.reply({ ...toEiEmbedPayload(fitDiscord(reply), "Cyrene"), allowedMentions: { parse: [], repliedUser: true } });
  });
});

// --- Slash Command Interaction Handler ---
client.on(Events.InteractionCreate, (rawInteraction) => {
  const interaction = withEiEmbedReplies(rawInteraction);
  if (!interaction.isChatInputCommand()) return;
  if (!identityVerified) {
    guarded("not-ready", () =>
      interaction.reply({ content: "AI bot is initializing. Please retry in a moment.", ephemeral: true }),
    );
    return;
  }

  if (activeCommands >= 20) {
    guarded("busy", () =>
      interaction.reply({ content: "AI service is busy. Please retry shortly.", ephemeral: true }),
    );
    return;
  }

  activeCommands++;
  guarded("command", async () => {
    try {
      if (!interaction.inCachedGuild() || !allowed.includes(interaction.guildId)) {
        await interaction.reply({ content: "This server is not approved for AI bot.", ephemeral: true });
        return;
      }

      if (await respondToCommonCommand(interaction, "Cyrene", "Mention Cyrene in a text channel to chat. Use `/speak`, `/tts`, `/leave`, `/search`, or `/translate` for local voice and translation features.")) return;

      await interaction.deferReply();
      if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows, interaction.guildId, botKey, interaction.commandName, [...interaction.member.roles.cache.keys()]))) {
        await interaction.editReply("This bot, server, or command is disabled for your roles.");
        return;
      }

      const options: Record<string, string | number | boolean> = {};
      for (const opt of interaction.options.data) {
        if (opt.value !== undefined) options[opt.name] = opt.value;
      }

      if (interaction.commandName === TRANSLATION_NAME) {
        const result = await respondToTranslationCommand({
          text: String(options.text ?? ""),
          targetLanguage: String(options.target_language ?? ""),
          ...(typeof options.source_language === "string" ? { sourceLanguage: options.source_language } : {}),
        });
        await interaction.editReply({ content: fitDiscord(result), allowedMentions: { parse: [] } });
        return;
      }

      if (TTS_NAMES.has(interaction.commandName)) {
        const member = interaction.member;
        const voiceChannelId =
          member && "voice" in member && member.voice?.channelId ? member.voice.channelId : null;
        const handled = await respondToTtsCommand(
          interaction.commandName,
          {
            guildId: interaction.guildId,
            userId: interaction.user.id,
            inVoiceChannel: voiceChannelId !== null,
            requestedVoice:
              typeof options.voice === "string" ? options.voice : undefined,
            text: typeof options.text === "string" ? options.text : undefined,
            query: typeof options.query === "string" ? options.query : undefined,
            reply: async (text) => {
              await interaction.editReply({ content: fitDiscord(text), allowedMentions: { parse: [] } });
            },
            sendAudio: async (audio) => {
              const ext = audio.mime.includes("wav") ? "wav" : "mp3";
              await interaction.editReply({
                ...toEiEmbedPayload("Your Cyrene audio file is ready.", "Cyrene · Voice file"),
                files: [{ attachment: Buffer.from(audio.bytes), name: `cyrene.${ext}` }],
              });
            },
            startTts: async () => {
              if (!voiceChannelId) return { ok: false as const, reason: "voice-unavailable" };
              return startCyreneSession(interaction.guildId, voiceChannelId, interaction.guild.voiceAdapterCreator);
            },
            playAudio: async (audio) => {
              if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows, interaction.guildId, botKey, interaction.commandName, [...interaction.member.roles.cache.keys()]))) return { ok: false as const, reason: "disabled" };
              if (!voiceChannelId) return { ok: false as const, reason: "voice-unavailable" };
              return playTtsAudio(
                interaction.guildId,
                voiceChannelId,
                interaction.guild.voiceAdapterCreator,
                audio,
              );
            },
            stopPlayback: async () => {
              await stopCyreneSession(interaction.guildId);
              voiceSessions.get(interaction.guildId)?.destroy();
              voiceSessions.delete(interaction.guildId);
            },
            search: async (_query) => "Search is not configured yet. Configure an approved search source before using this command.",
          },
          pool,
        );
        if (handled) return;
      }

      await respondToAiCommand(
        {
          name: interaction.commandName,
          options,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          key: interaction.id,
          askRouter: (prompt) => router.ask(prompt),
          dailyBudgetCap: DAILY_BUDGET_CAP,
          systemPrompt: cyrenePersona,
          defer: async () => {},
          reply: async (text) => {
            await interaction.editReply({ content: fitDiscord(text), allowedMentions: { parse: [] } });
          },
        },
        pool,
      );
    } catch (err) {
      if (interaction.deferred) {
        await interaction
          .editReply({ content: "AI request failed. Check usage and conversation status before retrying." })
          .catch(() => {});
      }
    } finally {
      activeCommands--;
    }
  });
});

client.on(Events.GuildCreate, (guild) => {
  if (!allowed.includes(guild.id)) guarded("leave-unapproved", () => guild.leave());
});

async function updateStatus(): Promise<void> {
  if (stopping || !identityVerified || !client.isReady()) return;
  try {
    const latency = Math.max(0, Math.round(client.ws.ping));
    for (const service of [`bot-${botKey}`]) {
      await pool.query(
        `INSERT INTO ops.service_status(service, liveness, gateway, db_ready, latency_ms)
         VALUES($1, 'ok', 'ok', true, $2)
         ON CONFLICT(service) DO UPDATE SET liveness='ok', gateway='ok', db_ready=true, latency_ms=EXCLUDED.latency_ms, updated_at=now()`,
        [service, latency],
      );
    }
    lastDbReady = true;
  } catch {
    lastDbReady = false;
  }
}

const statusTimer = setInterval(() => void updateStatus(), 5000);

// HTTP Health Check
const health = createServer((req, res) => {
  if (req.url === "/health/live") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-ai", status: "alive" }));
    return;
  }
  if (req.url === "/health/ready") {
    const ready = identityVerified && client.isReady() && lastDbReady && !stopping;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-ai", status: ready ? "ready" : "degraded" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
health.listen(Number(process.env.AI_HEALTH_PORT ?? 3104), "0.0.0.0");

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(statusTimer);
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  try {
    for (const guildId of cyreneVoiceSessions.keys()) await stopCyreneSession(guildId);
    client.destroy();
    health.close();
    await pool.end();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    console.error("Error during bot-ai shutdown:", err);
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

client.once(Events.ClientReady, () => {
  guarded("startup", async () => {
    cyrenePersona = await loadCyrenePersona();
    const registry = await pool.query("SELECT application_id FROM config.bots WHERE bot_key=$1", [botKey]);
    if (registry.rows[0]?.application_id !== client.user!.id) throw new Error("Registered application identity mismatch");
    identityVerified = true;
    for (const guild of client.guilds.cache.values()) {
      if (!allowed.includes(guild.id)) {
        await guild.leave();
        continue;
      }
      await client.rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: ALL_AI_COMMANDS.map((c) => c.toJSON()),
      });
    }
    await updateStatus();
    console.log(`bot-ai ready as ${client.user?.tag} across ${client.guilds.cache.size} guilds`);
  });
});

await client.login(token);
