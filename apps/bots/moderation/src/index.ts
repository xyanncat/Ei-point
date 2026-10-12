import { createServer } from "node:http";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Options,
  PermissionFlagsBits,
  Routes,
} from "discord.js";
import pg from "pg";
import { buildLogEvent } from "@ei-point/module-logging";
import { DUE_EXPIRY_SQL } from "@ei-point/module-moderation";
import { moderationCommandDefinitions, respondToModerationCommand } from "./commands.js";

const botKey = process.env.BOT_KEY ?? "kafka";
const url = process.env.DATABASE_URL;
const token = process.env.BOT_TOKEN ?? process.env.DISCORD_KAFKA_BOT_TOKEN ?? process.env.DISCORD_MODERATION_BOT_TOKEN;
const rawAllowlist =
  process.env.GUILD_ALLOWLIST ??
  process.env.COMMUNITY_GUILD_ALLOWLIST ??
  [process.env.DISCORD_TEST_GUILD_ID, process.env.DISCORD_MAIN_GUILD_ID].filter(Boolean).join(",");
const allowed = rawAllowlist
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

if (!url || !token || !allowed.length || allowed.some((x) => !/^\d{17,20}$/.test(x))) {
  throw new Error("Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST before starting the moderation bot.");
}

const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  application_name: "bot-moderation",
});
pool.on("error", () => console.error("moderation database connection interrupted"));
process.on("unhandledRejection", (err) => console.error("unhandledRejection in bot-moderation:", err));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  makeCache: Options.cacheWithLimits({ MessageManager: 50 }),
});

let stopping = false;
let identityVerified = false;
let lastDbReady = false;
let activeCommands = 0;

const guarded = (label: string, run: () => Promise<unknown>) => {
  void run().catch((err) =>
    console.error(`moderation ${label} failed:`, err instanceof Error ? err.message : String(err)),
  );
};

// Helper: record outbox log event with credential redaction
async function recordAuditLog(
  guildId: string,
  stream: "message" | "member" | "channel" | "role" | "voice",
  type: string,
  actorId: string | null,
  detail: Record<string, unknown>,
) {
  if (!identityVerified || !allowed.includes(guildId)) return;
  guarded(`log:${stream}:${type}`, async () => {
    const correlationId = `log-${guildId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const event = buildLogEvent({
      guildId,
      stream,
      type,
      actorId,
      detail,
      correlationId,
    });

    await pool.query(
      `INSERT INTO ops.outbox (aggregate, aggregate_id, type, payload, correlation_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [event.aggregate, event.aggregateId, event.type, JSON.stringify(event.payload), event.correlationId],
    );
  });
}

// --- Logging listeners ---
client.on(Events.MessageDelete, (message) => {
  if (!message.guildId) return;
  recordAuditLog(message.guildId, "message", "delete", message.author?.id ?? null, {
    channelId: message.channelId,
    content: message.content ?? "[unknown]",
    authorTag: message.author?.tag ?? "unknown",
  });
});

client.on(Events.MessageUpdate, (oldMsg, newMsg) => {
  if (!newMsg.guildId || oldMsg.content === newMsg.content) return;
  recordAuditLog(newMsg.guildId, "message", "update", newMsg.author?.id ?? null, {
    channelId: newMsg.channelId,
    oldContent: oldMsg.content ?? "",
    newContent: newMsg.content ?? "",
  });
});

client.on(Events.GuildMemberAdd, (member) => {
  recordAuditLog(member.guild.id, "member", "join", member.id, {
    tag: member.user.tag,
    accountCreatedMs: member.user.createdTimestamp,
  });
});

client.on(Events.GuildMemberRemove, (member) => {
  recordAuditLog(member.guild.id, "member", "leave", member.id, {
    tag: member.user.tag,
  });
});

client.on(Events.ChannelCreate, (channel) => {
  if ("guild" in channel) {
    recordAuditLog(channel.guild.id, "channel", "create", null, {
      channelId: channel.id,
      channelName: channel.name,
      type: channel.type,
    });
  }
});

client.on(Events.ChannelDelete, (channel) => {
  if ("guild" in channel) {
    recordAuditLog(channel.guild.id, "channel", "delete", null, {
      channelId: channel.id,
      channelName: channel.name,
    });
  }
});

client.on(Events.GuildRoleCreate, (role) => {
  recordAuditLog(role.guild.id, "role", "create", null, {
    roleId: role.id,
    roleName: role.name,
  });
});

client.on(Events.GuildRoleDelete, (role) => {
  recordAuditLog(role.guild.id, "role", "delete", null, {
    roleId: role.id,
    roleName: role.name,
  });
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = newState.guild?.id ?? oldState.guild?.id;
  if (!guildId) return;
  if (oldState.channelId !== newState.channelId) {
    recordAuditLog(guildId, "voice", newState.channelId ? "join" : "leave", newState.id, {
      oldChannelId: oldState.channelId,
      newChannelId: newState.channelId,
    });
  }
});

// Helper: load user staff scopes from access.staff_roles
async function loadStaffScopes(guildId: string, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const res = await pool.query<{ scope: string }>(
    "SELECT scope FROM access.staff_roles WHERE guild_id = $1 AND role_id = ANY($2)",
    [guildId, roleIds],
  );
  return res.rows.map((r) => r.scope);
}

// --- Interaction Handler ---
client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!identityVerified) {
    guarded("not-ready", () =>
      interaction.reply({ content: "Moderation bot is initializing. Please retry in a moment.", ephemeral: true }),
    );
    return;
  }

  if (activeCommands >= 20) {
    guarded("busy", () =>
      interaction.reply({ content: "Moderation service is busy. Please retry shortly.", ephemeral: true }),
    );
    return;
  }

  activeCommands++;
  guarded("command", async () => {
    try {
      if (!interaction.inCachedGuild() || !allowed.includes(interaction.guildId)) {
        await interaction.reply({ content: "This server is not approved for moderation bot.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const options: Record<string, string | number | boolean> = {};
      for (const opt of interaction.options.data) {
        if (opt.value !== undefined) options[opt.name] = opt.value;
      }

      const memberRoleIds = [...interaction.member.roles.cache.keys()];
      const userScopes = await loadStaffScopes(interaction.guildId, memberRoleIds);

      const targetMember = options.user ? await interaction.guild.members.fetch(String(options.user)).catch(() => null) : null;

      await respondToModerationCommand(
        {
          name: interaction.commandName,
          options,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          key: interaction.id,
          isOwner: interaction.guild.ownerId === interaction.user.id,
          canManage: interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
          userScopes,
          targetMember,
          defer: async () => {},
          reply: async (text) => {
            await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
          },
          banUser: async (targetId, deleteSeconds, reason) => {
            await interaction.guild.bans.create(targetId, { deleteMessageSeconds: deleteSeconds, reason });
          },
          unbanUser: async (targetId, reason) => {
            await interaction.guild.bans.remove(targetId, reason);
          },
          timeoutMember: async (member, durationMs, reason) => {
            await member.timeout(durationMs, reason);
          },
          bulkDeleteMessages: async (count) => {
            if (interaction.channel && "bulkDelete" in interaction.channel) {
              const res = await interaction.channel.bulkDelete(count, true);
              return res.size;
            }
            return 0;
          },
        },
        pool,
      );
    } catch (err) {
      if (interaction.deferred) {
        await interaction
          .editReply({ content: "Moderation action failed safely. Check bot permissions." })
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

// Periodic expiry reconciliation & service status
async function runMaintenance(): Promise<void> {
  if (stopping || !identityVerified || !client.isReady()) return;
  try {
    // Check due expiry cases
    const dueCases = await pool.query<{ case_id: string; guild_id: string; user_id: string; kind: string }>(
      DUE_EXPIRY_SQL,
      [10],
    );
    for (const c of dueCases.rows) {
      if (c.kind === "ban") {
        const guild = client.guilds.cache.get(c.guild_id);
        if (guild) {
          await guild.bans.remove(c.user_id, "Automated ban expiration").catch(() => {});
        }
      }
      // Clear expiry so it is not reprocessed
      await pool.query("UPDATE moderation.cases SET expires_at = NULL WHERE case_id = $1", [c.case_id]);
    }

    await pool.query(
      `INSERT INTO ops.service_status(service, liveness, gateway, db_ready, latency_ms)
       VALUES('bot-moderation', 'ok', 'ok', true, $1)
       ON CONFLICT(service) DO UPDATE SET liveness='ok', gateway='ok', db_ready=true, latency_ms=EXCLUDED.latency_ms, updated_at=now()`,
      [Math.max(0, Math.round(client.ws.ping))],
    );
    lastDbReady = true;
  } catch {
    lastDbReady = false;
  }
}

const maintenanceTimer = setInterval(() => void runMaintenance(), 10000);

// HTTP Health Check
const health = createServer((req, res) => {
  if (req.url === "/health/live") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-moderation", status: "alive" }));
    return;
  }
  if (req.url === "/health/ready") {
    const ready = identityVerified && client.isReady() && lastDbReady && !stopping;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-moderation", status: ready ? "ready" : "degraded" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
health.listen(Number(process.env.MODERATION_HEALTH_PORT ?? 3102), "0.0.0.0");

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(maintenanceTimer);
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  try {
    client.destroy();
    health.close();
    await pool.end();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    console.error("Error during bot-moderation shutdown:", err);
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

client.once(Events.ClientReady, () => {
  guarded("startup", async () => {
    identityVerified = true;
    for (const guild of client.guilds.cache.values()) {
      if (!allowed.includes(guild.id)) {
        await guild.leave();
        continue;
      }
      await client.rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: moderationCommandDefinitions.map((c) => c.toJSON()),
      });
    }
    await runMaintenance();
    console.log(`bot-moderation ready as ${client.user?.tag} across ${client.guilds.cache.size} guilds`);
  });
});

await client.login(token);
