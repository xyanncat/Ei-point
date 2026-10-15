import { randomUUID } from "node:crypto";
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
import { ttsCommandDefinitions, respondToTtsCommand } from "./tts.js";

const ALL_AI_COMMANDS = [...aiCommandDefinitions, ...ttsCommandDefinitions];
const TTS_NAMES = new Set(ttsCommandDefinitions.map((c) => c.name));

// Cyrene voice sessions: guildId -> voice connection (lazy @discordjs/voice).
const voiceSessions = new Map<string, { destroy: () => void }>();
const pendingVoice = new Set<string>();

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

if (!process.env.AI_PROVIDER_PRIMARY || !process.env.AI_PROVIDER_PRIMARY_KEY || !process.env.AI_PROVIDER_PRIMARY_MODEL?.trim()) throw new Error("AI_PROVIDER_PRIMARY, AI_PROVIDER_PRIMARY_KEY and AI_PROVIDER_PRIMARY_MODEL are required");
if ([process.env.AI_PROVIDER_FALLBACK, process.env.AI_PROVIDER_FALLBACK_KEY, process.env.AI_PROVIDER_FALLBACK_MODEL].some(Boolean) && (!process.env.AI_PROVIDER_FALLBACK || !process.env.AI_PROVIDER_FALLBACK_KEY || !process.env.AI_PROVIDER_FALLBACK_MODEL?.trim())) throw new Error("Fallback provider URL, key and model must all be configured together");
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

const guarded = (label: string, run: () => Promise<unknown>) => {
  void run().catch((err) =>
    console.error(`ai ${label} failed:`, err instanceof Error ? err.message : String(err)),
  );
};

// --- Handle Direct Mentions in Channels ---
const userMentionCooldown = new Map<string, number>();

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
      await message.reply("⏳ Please wait a few seconds before asking another question.");
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
      await message.reply("Hello! How can I help you today? You can also use `/ask` to chat with me.");
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
    );

    await message.reply({ content: fitDiscord(reply), allowedMentions: { parse: [], repliedUser: true } });
  });
});

// --- Slash Command Interaction Handler ---
client.on(Events.InteractionCreate, (interaction) => {
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

      await interaction.deferReply();
      if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows, interaction.guildId, botKey, interaction.commandName, [...interaction.member.roles.cache.keys()]))) {
        await interaction.editReply("This bot, server, or command is disabled for your roles.");
        return;
      }

      const options: Record<string, string | number | boolean> = {};
      for (const opt of interaction.options.data) {
        if (opt.value !== undefined) options[opt.name] = opt.value;
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
            reply: async (text) => {
              await interaction.editReply({ content: fitDiscord(text), allowedMentions: { parse: [] } });
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
              voiceSessions.get(interaction.guildId)?.destroy();
              voiceSessions.delete(interaction.guildId);
            },
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
