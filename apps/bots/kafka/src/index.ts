import { captureGuild, restoreGuild } from "@ei-point/bot-security/dist/snapshot.js";
import { applyLockdown } from "@ei-point/bot-security/dist/lockdown.js";
import { isControlEnabled, createInteractionClaims, createWorkGate, dispatchGuildCommand, responsePolicy } from "@ei-point/flow";
// Kafka: merged security + moderation + logging gateway (identity `kafka`).
// Single gateway connection serving both command trees. Replaces the
// transitional bot-security + bot-moderation pair sharing one token.
// Modules stay separate packages; this file only wires them together.

import { createServer } from "node:http";
import {
  AuditLogEvent,
  ChannelType,
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
  WHITELIST_CHECK_SQL,
  type GuardedAction,
} from "@ei-point/module-security";
import { buildLogEvent } from "@ei-point/module-logging";
import { CLAIM_DUE_EXPIRY_SQL, CLEAR_EXPIRY_SQL, RETRY_EXPIRY_SQL, SANCTION_LOCK_SQL, SANCTION_UNLOCK_SQL, expiryBackoffSeconds, reconcileExpiry, reconcileTemporaryEffect, sanctionLockKey, sanctionLookupOutcome, temporaryRoleCleanupPlan } from "@ei-point/module-moderation";
import { securityCommandDefinitions, respondToSecurityCommand } from "@ei-point/bot-security/dist/commands.js";
import { moderationCommandDefinitions, respondToModerationCommand } from "@ei-point/bot-moderation/dist/commands.js";
import { commonCommandDefinitions, respondToCommonCommand, withEiEmbedReplies } from "@ei-point/module-bot-ui";

const botKey = process.env.BOT_KEY ?? "kafka";
const url = process.env.DATABASE_URL;
const token =
  process.env.BOT_TOKEN ??
  process.env.DISCORD_KAFKA_BOT_TOKEN ??
  process.env.DISCORD_SECURITY_BOT_TOKEN ??
  process.env.DISCORD_MODERATION_BOT_TOKEN;
const rawAllowlist =
  process.env.GUILD_ALLOWLIST ??
  process.env.COMMUNITY_GUILD_ALLOWLIST ??
  [process.env.DISCORD_TEST_GUILD_ID, process.env.DISCORD_MAIN_GUILD_ID].filter(Boolean).join(",");
const allowed = rawAllowlist
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

if (!url || !token || allowed.length !== 2 || allowed.some((x) => !/^\d{17,20}$/.test(x))) {
  throw new Error("Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST (exactly two guild IDs) before starting the kafka bot.");
}

const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  application_name: "bot-kafka",
});
pool.on("error", () => console.error("kafka database connection interrupted"));
process.on("unhandledRejection", (err) => console.error("unhandledRejection in bot-kafka:", err));

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
// Bounded real-work admission: a slot is held until the command's work settles.
const commandGate = createWorkGate(20);
const interactionClaims = createInteractionClaims();

const recentJoins = new Map<string, number[]>();
const recentActorActions = new Map<string, number[]>();

function recordActorAction(guildId: string, actorId: string, action: GuardedAction): number {
  const key = `${guildId}:${actorId}:${action}`;
  const now = Date.now();
  const windowMs = 60_000;
  const history = (recentActorActions.get(key) ?? []).filter((t) => now - t <= windowMs);
  history.push(now);
  recentActorActions.set(key, history);
  if (recentActorActions.size > 500) {
    for (const [k, timestamps] of recentActorActions.entries()) {
      if (!timestamps.some((t) => now - t <= windowMs)) recentActorActions.delete(k);
    }
  }
  return history.length;
}

const guarded = (label: string, run: () => Promise<unknown>) => {
  void run().catch((err) =>
    console.error(`kafka ${label} failed:`, err instanceof Error ? err.message : String(err)),
  );
};

const ALL_COMMANDS = [
  ...commonCommandDefinitions(),
  ...[...securityCommandDefinitions, ...moderationCommandDefinitions].map((command) =>
    command.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ),
];

// --- Security: anti-raid on member join ---
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
      if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows, guildId, botKey))) return;
      await applyLockdown(pool, member.guild, true, client.user!.id, "Automated anti-raid lockdown triggered");
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
  recordAuditLog(member.guild.id, "member", "join", member.id, {
    tag: member.user.tag,
    accountCreatedMs: member.user.createdTimestamp,
  });
});

// --- Security: antinuke on audit-log entries ---
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
    if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows, guild.id, botKey))) return;
    const count = recordActorAction(guild.id, actorId, action);
    const isWhitelisted = (
      await pool.query(WHITELIST_CHECK_SQL, [guild.id, actorId])
    ).rowCount! > 0;
    const verdict = evaluateAction(action, count, isWhitelisted);
    if (verdict !== "allow") {
      await pool.query(RECORD_INCIDENT_SQL, [
        guild.id,
        `antinuke_${action}`,
        actorId,
        verdict === "quarantine" ? "critical" : "high",
        JSON.stringify({ action, count, verdict }),
        `antinuke-${guild.id}-${auditEntry.id}`,
      ]);
      await pool.query(`INSERT INTO security.trust_state(guild_id,user_id,score,updated_at)
        SELECT $1,$2,GREATEST(0,100-COALESCE(SUM(CASE severity WHEN 'critical' THEN 40 WHEN 'high' THEN 20 ELSE 10 END),0)::int),now()
        FROM security.incidents WHERE guild_id=$1 AND actor_id=$2 AND created_at>now()-interval '7 days'
        ON CONFLICT(guild_id,user_id) DO UPDATE SET score=EXCLUDED.score,updated_at=now()`, [guild.id, actorId]);
      if (verdict === "quarantine") {
        try {
          const member = await guild.members.fetch(actorId);
          if (member && member.manageable) {
            await member.roles.set([], "Antinuke quarantine: excessive administrative actions");
          }
        } catch {
          // Not manageable (owner / higher role) — incident is still recorded.
        }
      }
    }
  });
});

// --- Logging: outbox events with credential redaction ---
async function recordAuditLog(
  guildId: string,
  stream: "message" | "member" | "channel" | "role" | "voice",
  type: string,
  actorId: string | null,
  detail: Record<string, unknown>,
) {
  if (!identityVerified || !allowed.includes(guildId)) return;
  guarded(`log:${stream}:${type}`, async () => {
    if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows, guildId, botKey))) return;
    const correlationId = `log-${guildId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const event = buildLogEvent({ guildId, stream, type, actorId, detail, correlationId });
    await pool.query(
      `INSERT INTO ops.outbox (aggregate, aggregate_id, type, payload, correlation_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [event.aggregate, event.aggregateId, event.type, JSON.stringify(event.payload), event.correlationId],
    );
  });
}

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

client.on(Events.GuildMemberRemove, (member) => {
  recordAuditLog(member.guild.id, "member", "leave", member.id, { tag: member.user.tag });
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
  recordAuditLog(role.guild.id, "role", "create", null, { roleId: role.id, roleName: role.name });
});

client.on(Events.GuildRoleDelete, (role) => {
  recordAuditLog(role.guild.id, "role", "delete", null, { roleId: role.id, roleName: role.name });
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

async function loadStaffScopes(guildId: string, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const res = await pool.query<{ scope: string }>(
    "SELECT scope FROM access.staff_roles WHERE guild_id = $1 AND role_id = ANY($2)",
    [guildId, roleIds],
  );
  return res.rows.map((r) => r.scope);
}

const SECURITY_NAMES = new Set(securityCommandDefinitions.map((c) => c.name));

// --- Merged interaction router ---
client.on(Events.InteractionCreate, (rawInteraction) => {
  if (!rawInteraction.isChatInputCommand()) return;
  const interaction = withEiEmbedReplies(rawInteraction, responsePolicy(botKey, rawInteraction.commandName).imageKey);
  if (!identityVerified) {
    guarded("not-ready", () =>
      interaction.reply({ content: "Kafka is initializing. Please retry in a moment.", ephemeral: true }),
    );
    return;
  }
  guarded("command", async () => {
    if (!interaction.inCachedGuild() || !allowed.includes(interaction.guildId)) {
      await interaction.reply({ content: "This server is not approved for Kafka.", ephemeral: true });
      return;
    }
    if (await respondToCommonCommand(interaction, "Kafka", "Guild security, moderation, and audit controls.")) return;
    await dispatchGuildCommand({
      botKey,
      allowlist: allowed,
      interaction,
      operationId: interaction.id,
      operation: interaction.commandName,
      gate: commandGate,
      claims: interactionClaims,
      authorize: async () => {
        if (!interaction.inCachedGuild()) {
          return { content: "Kafka security and moderation commands require the guild owner or an Administrator." };
        }
        const isOwner = interaction.guild.ownerId === interaction.user.id;
        const isAdministrator = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
        if (!isOwner && !isAdministrator) {
          return { content: "Kafka security and moderation commands require the guild owner or an Administrator." };
        }
        if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows,
          interaction.guildId, botKey, interaction.commandName, [...interaction.member.roles.cache.keys()]))) {
          return { content: "This command is disabled, paused, or restricted by server controls." };
        }
        return undefined;
      },
      run: async (ctx) => {
        ctx.signal.throwIfAborted();
        if (!interaction.inCachedGuild()) throw new Error("guild context unavailable");
        const isSecurity = SECURITY_NAMES.has(interaction.commandName);

        if (isSecurity) {
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
              captureSnapshot: async () => captureGuild(interaction.guild),
              restoreSnapshot: async (snapshot, snapshotId) => restoreGuild(pool, interaction.guild, snapshot, snapshotId, interaction.user.id, interaction.id),
              setLockdown: async (active, reason) => applyLockdown(pool, interaction.guild, active, interaction.user.id, reason),
              getGuildChannels: async () =>
                interaction.guild.channels.cache.map((c) => ({ id: c.id, name: c.name })),
              getGuildRoles: async () =>
                interaction.guild.roles.cache.map((r) => ({ id: r.id, name: r.name })),
            },
            pool,
          );
          return undefined;
        }

        const options: Record<string, string | number | boolean> = {};
        const collectOptions = (items: Array<{ name: string; value?: unknown; options?: Array<{ name: string; value?: unknown; options?: unknown[] }> }>) => {
          for (const opt of items) {
            if (opt.options) collectOptions(opt.options as typeof items);
            else if (typeof opt.value === "string" || typeof opt.value === "number" || typeof opt.value === "boolean") options[opt.name] = opt.value;
          }
        };
        collectOptions(interaction.options.data as unknown as Parameters<typeof collectOptions>[0]);
        const memberRoleIds = [...interaction.member.roles.cache.keys()];
        const userScopes = await loadStaffScopes(interaction.guildId, memberRoleIds);
        const targetMember = options.user
          ? await interaction.guild.members.fetch(String(options.user)).catch(() => null)
          : null;
        const targetRole = options.role ? interaction.guild.roles.cache.get(String(options.role)) ?? null : null;
        const channelId = options.channel ? String(options.channel) : undefined;
        await respondToModerationCommand(
          {
            name: interaction.commandName,
            subcommand: interaction.options.getSubcommand(false) ?? undefined,
            options,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            key: interaction.id,
            isOwner: interaction.guild.ownerId === interaction.user.id,
            canManage: interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
            userScopes,
            targetMember,
            targetRole,
            channelId,
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
            kickMember: async (member, reason) => { await member.kick(reason); },
            addMemberRole: async (member, role, reason) => { await member.roles.add(role, reason); },
            removeMemberRole: async (guildId, userId, roleId, reason) => {
              const guild = client.guilds.cache.get(guildId);
              const role = guild?.roles.cache.get(roleId);
              const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
              if (role && member?.roles.cache.has(roleId)) await member.roles.remove(role, reason);
            },
            clearTimeout: async (member, reason) => {
              await member.timeout(0, reason);
            },
            getRestrictionState: async (targetChannelId, targetUserId) => {
              const channel = interaction.guild.channels.cache.get(targetChannelId);
              if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) throw new Error("Unsupported restriction channel");
              const overwrite = channel.permissionOverwrites.cache.get(targetUserId);
              const state = (flag: bigint): boolean | null => overwrite?.deny.has(flag) ? false : overwrite?.allow.has(flag) ? true : null;
              return { sendMessages: state(PermissionFlagsBits.SendMessages), sendMessagesInThreads: state(PermissionFlagsBits.SendMessagesInThreads) };
            },
            setRestrictionState: async (targetChannelId, targetUserId, state, reason) => {
              const channel = interaction.guild.channels.cache.get(targetChannelId);
              if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) throw new Error("Unsupported restriction channel");
              await channel.permissionOverwrites.edit(targetUserId, { SendMessages: state.sendMessages, SendMessagesInThreads: state.sendMessagesInThreads }, { reason });
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
        return undefined;
      },
      failureReply: (category): { content: string } => ({
        content: category === "auth" ? "This server is not approved for Kafka."
          : category === "permissions" ? "Kafka security and moderation commands require the guild owner or an Administrator."
            : category === "duplicate" ? "Kafka is already processing this interaction. Check the result before retrying."
              : category === "shutting-down" ? "Kafka is shutting down. Please retry in a moment."
                : category === "queue-full" ? "Kafka service is busy. Please retry shortly."
                  : category === "timeout" ? "Kafka operation outcome is unconfirmed. Check moderation cases and system logs before retrying."
                    : "Kafka operation outcome is unconfirmed. Check moderation cases and system logs before retrying.",
      }),
      onTelemetry: (event) => console.info("kafka interaction lifecycle", event),
    });
  });
});

client.on(Events.GuildCreate, (guild) => {
  if (!allowed.includes(guild.id)) guarded("leave-unapproved", () => guild.leave());
});

// --- Maintenance: expiry reconciliation + service status (kafka + legacy keys) ---
const expiryLeaseBase = `kafka-${process.pid}`;
let expiryGeneration = 0;
let maintenanceRunning = false;
const GUILD_UNAVAILABLE = "guild-unavailable";
async function runMaintenance(): Promise<void> {
  // Single-flight: overlapping ticks would compile duplicate Discord effects and
  // stack leases; the leasable rows still guard multi-process overlap (A07).
  if (maintenanceRunning || stopping || !identityVerified || !client.isReady()) return;
  maintenanceRunning = true;
  const leaseOwner = `${expiryLeaseBase}-${++expiryGeneration}`;
  try {
    const dueCases = await pool.query<{ case_id: string; guild_id: string; user_id: string; kind: string; metadata: Record<string, unknown> | null; attempt_count: number }>(
      CLAIM_DUE_EXPIRY_SQL,
      [10, leaseOwner],
    );
    for (const c of dueCases.rows) {
      // Serialize ownership re-check + Discord effect against a parallel new sanction
      // (executeSanction takes the same advisory lock before apply/supersede).
      const lockKey = sanctionLockKey(c.guild_id, c.user_id, c.kind);
      await pool.query(SANCTION_LOCK_SQL, [lockKey]);
      try {
        // Expiry cleanup is a compensating action for a previously authorized sanction.
        // Do not strand temporary effects when an operator pauses the bot or guild.
        if (c.kind === "temp_role" || c.kind === "temp_restriction") {
          const metadata = c.metadata ?? {};
          const settled = await reconcileTemporaryEffect(c.kind, async () => {
            const guild = client.guilds.cache.get(c.guild_id);
            if (!guild) throw new Error(GUILD_UNAVAILABLE);
            if (c.kind === "temp_role") {
              const roleId = typeof metadata.roleId === "string" ? metadata.roleId : "";
              if (!roleId) return "conflict";
              // Only authoritative Discord absence (100xx) closes the case; transient
              // fetch failures stay retryable so the expiry is not falsely acknowledged.
              const role = await guild.roles.fetch(roleId).catch((error: { code?: number }) => {
                if (sanctionLookupOutcome(error) === "absent") return null;
                throw error;
              });
              const member = role
                ? await guild.members.fetch(c.user_id).catch((error: { code?: number }) => {
                    if (sanctionLookupOutcome(error) === "absent") return null;
                    throw error;
                  })
                : null;
              const plan = temporaryRoleCleanupPlan({ roleExists: !!role, memberExists: !!member, memberHasRole: !!member?.roles.cache.has(roleId) });
              if (plan === "remove-role" && role && member) await member.roles.remove(role, "Temporary role expired");
              return "restored";
            }
            const channelId = typeof metadata.channelId === "string" ? metadata.channelId : "";
            if (!channelId) return "conflict";
            const channel = await guild.channels.fetch(channelId).catch((error: { code?: number }) => {
              if (sanctionLookupOutcome(error) === "absent") return null;
              throw error;
            });
            if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return "restored";
            const overwrite = channel.permissionOverwrites.cache.get(c.user_id);
            const current = {
              sendMessages: overwrite?.deny.has(PermissionFlagsBits.SendMessages) ? false : overwrite?.allow.has(PermissionFlagsBits.SendMessages) ? true : null,
              sendMessagesInThreads: overwrite?.deny.has(PermissionFlagsBits.SendMessagesInThreads) ? false : overwrite?.allow.has(PermissionFlagsBits.SendMessagesInThreads) ? true : null,
            };
            const previous = {
              sendMessages: typeof metadata.previousSendMessages === "boolean" ? metadata.previousSendMessages : null,
              sendMessagesInThreads: typeof metadata.previousSendMessagesInThreads === "boolean" ? metadata.previousSendMessagesInThreads : null,
            };
            if (current.sendMessages === previous.sendMessages && current.sendMessagesInThreads === previous.sendMessagesInThreads) return "restored";
            if (current.sendMessages !== false || current.sendMessagesInThreads !== false) return "conflict";
            await channel.permissionOverwrites.edit(c.user_id, { SendMessages: previous.sendMessages, SendMessagesInThreads: previous.sendMessagesInThreads }, { reason: "Temporary restriction expired" });
            return "restored";
          }, async (outcome) => {
            await pool.query(CLEAR_EXPIRY_SQL, [c.case_id, outcome === "restored" ? "expired" : "conflict", leaseOwner]);
            if (outcome === "conflict") console.warn(`temporary moderation case ${c.case_id} (${c.kind}) requires manual reconciliation`);
          });
          if (!settled) await pool.query(RETRY_EXPIRY_SQL, [c.case_id, expiryBackoffSeconds(c.attempt_count ?? 0), "discord-unconfirmed", leaseOwner]);
          continue;
        }
        // Ownership re-check under the claim and the sanction lock: a newer equal-kind
        // sanction must not be undone by this older expiry.
        const secondary = await pool.query<{ case_id: string }>(
          `SELECT n.case_id FROM moderation.cases n JOIN moderation.cases c ON c.case_id=$1
           WHERE n.guild_id=c.guild_id AND n.user_id=c.user_id AND n.kind=c.kind
             AND n.case_id>c.case_id AND n.execution_status='applied' AND n.superseded_by IS NULL LIMIT 1`,
          [c.case_id],
        );
        if (secondary.rows.length) {
          await pool.query(CLEAR_EXPIRY_SQL, [c.case_id, "superseded", leaseOwner]);
          continue;
        }
        const settled = await reconcileExpiry(c.kind, async () => {
          const guild = client.guilds.cache.get(c.guild_id);
          if (!guild) throw new Error(GUILD_UNAVAILABLE);
          await guild.bans.remove(c.user_id, "Automated ban expiration");
        }, async () => {
          await pool.query(CLEAR_EXPIRY_SQL, [c.case_id, "expired", leaseOwner]);
        });
        if (!settled) await pool.query(RETRY_EXPIRY_SQL, [c.case_id, expiryBackoffSeconds(c.attempt_count ?? 0), "discord-unconfirmed", leaseOwner]);
      } finally {
        await pool.query(SANCTION_UNLOCK_SQL, [lockKey]).catch(() => {});
      }
    }
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
  } finally {
    maintenanceRunning = false;
  }
}

const maintenanceTimer = setInterval(() => void runMaintenance(), 10000);

const health = createServer((req, res) => {
  if (req.url === "/health/live") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-kafka", status: "alive" }));
    return;
  }
  if (req.url === "/health/ready") {
    const ready = identityVerified && client.isReady() && lastDbReady && !stopping;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-kafka", status: ready ? "ready" : "degraded" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
health.listen(Number(process.env.KAFKA_HEALTH_PORT ?? process.env.SECURITY_HEALTH_PORT ?? 3101), "0.0.0.0");

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(maintenanceTimer);
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  try {
    commandGate.close();
    await commandGate.drain(10000);
    client.destroy();
    health.close();
    await pool.end();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    console.error("Error during bot-kafka shutdown:", err);
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

client.once(Events.ClientReady, () => {
  guarded("startup", async () => {
    const registered = (await pool.query("SELECT application_id FROM config.bots WHERE bot_key=$1", [botKey])).rows[0];
    if (registered?.application_id !== client.user!.id) {
      console.error("Token identity does not match the registered BOT_KEY");
      await shutdown();
      return;
    }
    identityVerified = true;
    for (const guild of client.guilds.cache.values()) {
      try {
        if (!allowed.includes(guild.id)) await guild.leave();
      } catch (err) {
        console.error(`Failed setup for guild ${guild.id}:`, err);
      }
    }
    // Single source of truth: global registration only (no guild copies).
    await client.rest.put(Routes.applicationCommands(client.user!.id), {
      body: ALL_COMMANDS.map((c) => c.toJSON()),
    });
    // Registry self-check: warn if the kafka row is missing.
    try {
      const reg = await pool.query("SELECT bot_key FROM config.bots WHERE bot_key = $1", [botKey]);
      if ((reg.rowCount ?? 0) === 0) console.warn(`kafka registry row missing for BOT_KEY=${botKey}`);
    } catch {
      // DB may be briefly unavailable at boot; maintenance loop retries.
    }
    await runMaintenance();
    console.log(`bot-kafka ready as ${client.user?.tag} across ${client.guilds.cache.size} guilds`);
  });
});

await client.login(token);
