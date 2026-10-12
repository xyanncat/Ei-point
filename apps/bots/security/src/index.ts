import { createServer } from "node:http";
import {
  AuditLogEvent,
  Client,
  Events,
  GatewayIntentBits,
  Options,
  PermissionFlagsBits,
  Routes,
} from "discord.js";
import pg from "pg";
import {
  detectRaid,
  evaluateAction,
  RECORD_INCIDENT_SQL,
  SET_LOCKDOWN_SQL,
  WHITELIST_CHECK_SQL,
  type GuardedAction,
} from "@ei-point/module-security";
import { securityCommandDefinitions, respondToSecurityCommand } from "./commands.js";

const botKey = process.env.BOT_KEY ?? "kafka";
const url = process.env.DATABASE_URL;
const token = process.env.BOT_TOKEN ?? process.env.DISCORD_KAFKA_BOT_TOKEN ?? process.env.DISCORD_SECURITY_BOT_TOKEN;
const rawAllowlist =
  process.env.GUILD_ALLOWLIST ??
  process.env.COMMUNITY_GUILD_ALLOWLIST ??
  [process.env.DISCORD_TEST_GUILD_ID, process.env.DISCORD_MAIN_GUILD_ID].filter(Boolean).join(",");
const allowed = rawAllowlist
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

if (!url || !token || !allowed.length || allowed.some((x) => !/^\d{17,20}$/.test(x))) {
  throw new Error("Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST before starting the security bot.");
}

const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  application_name: "bot-security",
});
pool.on("error", () => console.error("security database connection interrupted"));
process.on("unhandledRejection", (err) => console.error("unhandledRejection in bot-security:", err));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
  makeCache: Options.cacheWithLimits({ MessageManager: 0 }),
});

let stopping = false;
let identityVerified = false;
let lastDbReady = false;
let activeCommands = 0;

// Anti-raid tracker: guildId -> list of join timestamps (ms)
const recentJoins = new Map<string, number[]>();

// Antinuke tracker: `${guildId}:${actorId}:${action}` -> list of action timestamps (ms)
const recentActorActions = new Map<string, number[]>();

function recordActorAction(guildId: string, actorId: string, action: GuardedAction): number {
  const key = `${guildId}:${actorId}:${action}`;
  const now = Date.now();
  const windowMs = 60_000;
  const history = (recentActorActions.get(key) ?? []).filter((t) => now - t <= windowMs);
  history.push(now);
  recentActorActions.set(key, history);

  // Periodic eviction of expired tracking keys
  if (recentActorActions.size > 500) {
    for (const [k, timestamps] of recentActorActions.entries()) {
      if (!timestamps.some((t) => now - t <= windowMs)) {
        recentActorActions.delete(k);
      }
    }
  }
  return history.length;
}

const guarded = (label: string, run: () => Promise<unknown>) => {
  void run().catch((err) =>
    console.error(`security ${label} failed:`, err instanceof Error ? err.message : String(err)),
  );
};

// --- Anti-Raid detection on member join ---
client.on(Events.GuildMemberAdd, (member) => {
  if (!identityVerified || !allowed.includes(member.guild.id)) return;
  const guildId = member.guild.id;
  const now = Date.now();
  const history = (recentJoins.get(guildId) ?? []).filter((t) => now - t <= 60_000);
  history.push(now);
  recentJoins.set(guildId, history);

  if (detectRaid(history, 8, 60_000)) {
    const joinCount = history.length;
    recentJoins.set(guildId, []);
    guarded("raid-mitigation", async () => {
      console.warn(`[SECURITY] Raid detected in guild ${guildId} (${joinCount} joins in 60s)! Engaging lockdown.`);
      await pool.query(SET_LOCKDOWN_SQL, [guildId, "Automated anti-raid lockdown triggered", client.user!.id]);
      await pool.query(RECORD_INCIDENT_SQL, [
        guildId,
        "raid_detected",
        null,
        "high",
        JSON.stringify({ joinCount, windowMs: 60000 }),
        `raid-${guildId}-${Math.floor(now / 60000)}`,
      ]);
    });
  }
});

const AUDIT_ACTION_MAP: Partial<Record<AuditLogEvent, GuardedAction>> = {
  [AuditLogEvent.MemberBanAdd]: "ban",
  [AuditLogEvent.MemberKick]: "kick",
  [AuditLogEvent.ChannelDelete]: "channel_delete",
  [AuditLogEvent.RoleDelete]: "role_delete",
};

client.on(Events.GuildAuditLogEntryCreate, async (auditEntry, guild) => {
  if (!identityVerified || !allowed.includes(guild.id)) return;
  const action = AUDIT_ACTION_MAP[auditEntry.action as AuditLogEvent];
  if (!action) return;

  const actorId = auditEntry.executorId;
  if (!actorId || actorId === client.user?.id) return;

  guarded(`antinuke:${action}`, async () => {
    const count = recordActorAction(guild.id, actorId, action);
    // Check whitelist
    const isWhitelisted = (
      await pool.query(WHITELIST_CHECK_SQL, [guild.id, actorId])
    ).rowCount! > 0;

    const verdict = evaluateAction(action, count, isWhitelisted);

    if (verdict !== "allow") {
      console.warn(`[ANTINUKE] Verdict ${verdict} for actor ${actorId} performing ${action} (count=${count}) in guild ${guild.id}`);
      await pool.query(RECORD_INCIDENT_SQL, [
        guild.id,
        `antinuke_${action}`,
        actorId,
        verdict === "quarantine" ? "critical" : "high",
        JSON.stringify({ action, count, verdict }),
        `antinuke-${guild.id}-${actorId}-${action}-${Date.now()}`,
      ]);

      if (verdict === "quarantine") {
        // Strip dangerous roles from the rogue actor if possible
        try {
          const member = await guild.members.fetch(actorId);
          if (member && member.manageable) {
            await member.roles.set([], "Antinuke quarantine: excessive administrative actions");
          }
        } catch {
          // Member may not be manageable (e.g. server owner or higher role)
        }
      }
    }
  });
});

// --- Slash command interactions ---
client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!identityVerified) {
    guarded("not-ready", () =>
      interaction.reply({ content: "Security bot is initializing. Please retry in a moment.", ephemeral: true }),
    );
    return;
  }

  if (activeCommands >= 20) {
    guarded("busy", () =>
      interaction.reply({ content: "Security service is busy. Please retry shortly.", ephemeral: true }),
    );
    return;
  }

  activeCommands++;
  guarded("command", async () => {
    try {
      if (!interaction.inCachedGuild() || !allowed.includes(interaction.guildId)) {
        await interaction.reply({ content: "This server is not approved for security bot.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const options: Record<string, string | number | boolean> = {};
      const flatten = (values: typeof interaction.options.data): void => {
        for (const option of values) {
          if (option.value !== undefined) options[option.name] = option.value;
          if (option.options) flatten(option.options);
        }
      };
      flatten(interaction.options.data);

      const subGroup = interaction.options.getSubcommandGroup(false) ?? undefined;
      const sub = interaction.options.getSubcommand(false) ?? undefined;

      await respondToSecurityCommand(
        {
          name: interaction.commandName,
          subcommandGroup: subGroup,
          subcommand: sub,
          options,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          key: interaction.id,
          isOwner: interaction.guild.ownerId === interaction.user.id,
          canManage: interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
          defer: async () => {},
          reply: async (text) => {
            await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
          },
          getGuildChannels: async () =>
            interaction.guild.channels.cache.map((c) => ({ id: c.id, name: c.name })),
          getGuildRoles: async () =>
            interaction.guild.roles.cache.map((r) => ({ id: r.id, name: r.name })),
        },
        pool,
      );
    } catch (err) {
      console.error("security command failed:", err instanceof Error ? err.message : String(err));
      if (interaction.deferred) {
        await interaction
          .editReply({ content: "Security operation failed safely. Inspect system logs." })
          .catch(() => {});
      }
    } finally {
      activeCommands--;
    }
  });
});

client.on(Events.GuildCreate, (guild) => {
  if (!allowed.includes(guild.id)) {
    guarded("leave-unapproved", () => guild.leave());
    return;
  }
  if (identityVerified && client.user) {
    guarded("guild-create-setup", async () => {
      await client.rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: securityCommandDefinitions.map((c) => c.toJSON()),
      });
    });
  }
});

// Periodic heartbeat & status recording
async function updateStatus(): Promise<void> {
  if (stopping || !identityVerified || !client.isReady()) return;
  try {
    await pool.query(
      `INSERT INTO ops.service_status(service, liveness, gateway, db_ready, latency_ms)
       VALUES('bot-security', 'ok', 'ok', true, $1)
       ON CONFLICT(service) DO UPDATE SET liveness='ok', gateway='ok', db_ready=true, latency_ms=EXCLUDED.latency_ms, updated_at=now()`,
      [Math.max(0, Math.round(client.ws.ping))],
    );
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
    res.end(JSON.stringify({ service: "bot-security", status: "alive" }));
    return;
  }
  if (req.url === "/health/ready") {
    const ready = identityVerified && client.isReady() && lastDbReady && !stopping;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-security", status: ready ? "ready" : "degraded" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
health.listen(Number(process.env.SECURITY_HEALTH_PORT ?? 3101), "0.0.0.0");

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
    console.error("Error during bot-security shutdown:", err);
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
      try {
        if (!allowed.includes(guild.id)) {
          await guild.leave();
          continue;
        }
        await client.rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
          body: securityCommandDefinitions.map((c) => c.toJSON()),
        });
      } catch (err) {
        console.error(`Failed setup for guild ${guild.id}:`, err);
      }
    }
    await updateStatus();
    console.log(`bot-security ready as ${client.user?.tag} across ${client.guilds.cache.size} guilds`);
  });
});

await client.login(token);
