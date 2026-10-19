import { deliverAnnouncement } from "./delivery.js";
import { applyCommunityConfiguration, createInteractionClaims, createWorkGate, deliverCommunityMessages, dispatchGuildCommand, isControlEnabled, responsePolicy } from "@ei-point/flow";
// Himiko owns announcements, welcome/leave events, and community XP/levels.

import { createServer } from "node:http";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Options,
  PermissionFlagsBits,
  Routes,
} from "discord.js";
import pg from "pg";
import { himikoCommandDefinitions, validateAnnounceInput, buildAnnouncePayload } from "./commands.js";
import { COMMUNITY_ADMIN_COMMANDS, communityCommandDefinitions, respondToCommunityCommand } from "./community-commands.js";
import { eligibleVoiceXpUsers, voiceXpEventKey } from "./voice-xp.js";
import { CommunityService } from "@ei-point/module-community";
import { commonCommandDefinitions, createEiEmbed, toEiComponentPayload, respondToCommonCommand, withEiEmbedReplies } from "@ei-point/module-bot-ui";

const botKey = process.env.BOT_KEY ?? "himiko";
const url = process.env.DATABASE_URL;
const token = process.env.BOT_TOKEN ?? process.env.DISCORD_HIMIKO_BOT_TOKEN;
const rawAllowlist =
  process.env.GUILD_ALLOWLIST ??
  process.env.COMMUNITY_GUILD_ALLOWLIST ??
  [process.env.DISCORD_TEST_GUILD_ID, process.env.DISCORD_MAIN_GUILD_ID].filter(Boolean).join(",");
const allowed = rawAllowlist
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

if (!url || !token || allowed.length !== 2 || allowed.some((x) => !/^\d{17,20}$/.test(x))) {
  throw new Error("Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST (exactly two guild IDs) before starting the himiko bot.");
}

const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  application_name: "bot-himiko",
});
const community = new CommunityService(pool);
const controlQuery = async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows;
pool.on("error", () => console.error("himiko database connection interrupted"));
process.on("unhandledRejection", (err) => console.error("unhandledRejection in bot-himiko:", err));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
  makeCache: Options.cacheWithLimits({ MessageManager: 0 }),
});

let stopping = false;
let identityVerified = false;
let lastDbReady = false;
// Bounded real-work admission: a slot is held until the command's work settles.
const commandGate = createWorkGate(20);
const interactionClaims = createInteractionClaims();
let activeXp = 0;
let pumping = false;
let lastXpCleanup = 0;
let voiceXpPumping = false;
const voiceXpCursors = new Map<string, number>();

const guarded = (label: string, run: () => Promise<unknown>) => {
  void run().catch((err) =>
    console.error(`himiko ${label} failed:`, err instanceof Error ? err.message : String(err)),
  );
};

async function loadStaffScopes(guildId: string, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const res = await pool.query<{ scope: string }>(
    "SELECT scope FROM access.staff_roles WHERE guild_id = $1 AND role_id = ANY($2)",
    [guildId, roleIds],
  );
  return res.rows.map((r) => r.scope);
}

client.on(Events.InteractionCreate, (rawInteraction) => {
  if (!rawInteraction.isChatInputCommand()) return;
  const interaction = withEiEmbedReplies(rawInteraction, responsePolicy(botKey, rawInteraction.commandName).imageKey);
  if (!identityVerified) {
    guarded("not-ready", () =>
      interaction.reply({ content: "Himiko is initializing. Please retry in a moment.", ephemeral: true }),
    );
    return;
  }
  guarded("command", async () => {
    try {
      if (interaction.inCachedGuild() && await respondToCommonCommand(interaction, "Himiko", "Announcements, embed publishing, welcome and leave messages, and text and voice XP.")) return;
      let guildGrant = false;
      await dispatchGuildCommand({
        botKey,
        allowlist: allowed,
        interaction,
        operationId: interaction.id,
        operation: interaction.commandName,
        gate: commandGate,
        claims: interactionClaims,
        authorize: async () => {
          if (!interaction.inCachedGuild()) return { content: "Himiko commands are only available in an approved server." };
          const memberRoleIds = [...interaction.member.roles.cache.keys()];
          if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows,
            interaction.guildId, botKey, interaction.commandName, memberRoleIds))) {
            return { content: "This command is disabled, paused, or restricted by server controls." };
          }
          if (COMMUNITY_ADMIN_COMMANDS.has(interaction.commandName)) {
            return interaction.guild.ownerId === interaction.user.id ||
              interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
              ? undefined
              : { content: "Permission denied: Manage Server is required." };
          }
          const scopes = await loadStaffScopes(interaction.guildId, memberRoleIds);
          // Guild grants may bypass channel Manage Messages; destination checks still apply below.
          guildGrant = interaction.guild.ownerId === interaction.user.id || scopes.includes("announce") || scopes.includes("*");
          const guildManage = interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages);
          return guildGrant || guildManage
            ? undefined
            : { content: "Permission denied: Manage Messages or announce staff scope required." };
        },
        run: async (ctx) => {
          ctx.signal.throwIfAborted();
          if (!interaction.inCachedGuild()) throw new Error("guild context unavailable");
          const commandOptions: Record<string, string | number | boolean> = {};
          const flatten = (values: typeof interaction.options.data): void => {
            for (const option of values) {
              if (option.value !== undefined) commandOptions[option.name] = option.value;
              if (option.options) flatten(option.options);
            }
          };
          flatten(interaction.options.data);
          const communityResponse = await respondToCommunityCommand({
            name: interaction.commandName,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            username: interaction.user.username,
            guildName: interaction.guild.name,
            memberCount: interaction.guild.memberCount,
            options: commandOptions,
          }, community);
          if (communityResponse !== null) return { content: communityResponse.slice(0, 3900) };
          if (interaction.commandName === "embed") {
            const checked = validateAnnounceInput({
              channelId: interaction.channelId!,
              title: interaction.options.getString("title", true),
              description: interaction.options.getString("description", true),
              color: interaction.options.getString("color") ?? "#B6A0FF",
            });
            if (!checked.ok) return { content: `Invalid embed: ${checked.reason}.` };
            const embed = new EmbedBuilder().setTitle(checked.value.title).setDescription(checked.value.description)
              .setColor(parseInt(checked.value.color!.slice(1), 16));
            return { content: "Preview (only you can see this):", embeds: [embed] };
          }

          if (interaction.commandName !== "announcement") return { content: "Unknown Himiko command." };
          const channel = interaction.options.getChannel("channel", true);
          const pingRole = interaction.options.getRole("ping_role") ?? undefined;
          const checked = validateAnnounceInput({
            channelId: channel.id,
            title: interaction.options.getString("title", true),
            description: interaction.options.getString("description", true),
            ...(interaction.options.getString("color") ? { color: interaction.options.getString("color")! } : {}),
            ...(pingRole ? { pingRoleId: pingRole.id } : {}),
          });
          if (!checked.ok) return { content: `Invalid announcement: ${checked.reason}.` };
          const payload = buildAnnouncePayload(interaction.guildId!, checked.value);
          const embed = createEiEmbed({
            title: payload.title,
            description: payload.description,
            color: parseInt(String(payload.color).slice(1), 16),
          });
          const target = await interaction.guild.channels.fetch(payload.channel_id).catch(() => null);
          if (!target || !target.isTextBased() || !("send" in target)) return { content: "Destination channel is not a sendable text channel." };
          const callerPerms = "permissionsFor" in target ? target.permissionsFor(interaction.member) : null;
          if (!guildGrant && !callerPerms?.has(PermissionFlagsBits.ManageMessages)) {
            return { content: "Permission denied: Manage Messages is required in the destination channel." };
          }
          const me = interaction.guild.members.me;
          const perms = me && "permissionsFor" in target ? target.permissionsFor(me) : null;
          if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
            return { content: "Himiko cannot post there: missing Send Messages / Embed Links in that channel." };
          }
          if (checked.value.pingRoleId && callerPerms?.has(PermissionFlagsBits.MentionEveryone) !== true && pingRole?.mentionable !== true) {
            return { content: "That role is not mentionable and you lack Mention Everyone there." };
          }
          ctx.signal.throwIfAborted();
          await deliverAnnouncement(async(sql,args)=>(await pool.query(sql,args)).rows, interaction.id,
            { ...payload, by: interaction.user.id, guild_id: interaction.guildId }, async nonce => {
              await target.send({
                ...toEiComponentPayload({ content: payload.content ?? "", embeds: [embed] }, "himiko"),
                allowedMentions: payload.content ? { roles: [checked.value.pingRoleId!] } : { parse: [] },
                nonce, enforceNonce: true,
              });
            });
          return { content: `Announcement posted to <#${payload.channel_id}>.` };
        },
        failureReply: (category) => ({
          content: category === "auth"
            ? "This server is not approved for Himiko."
            : category === "permissions"
              ? "Permission denied."
              : category === "duplicate"
                ? "Himiko is already processing this interaction. Check its result before retrying."
                : category === "shutting-down"
                  ? "Himiko is shutting down. Please retry in a moment."
                  : category === "queue-full"
                    ? "Himiko service is busy. Please retry shortly."
                    : category === "timeout"
                      ? "Himiko operation outcome is unconfirmed. Check its status before retrying."
                      : "Himiko operation outcome is unconfirmed. Inspect system logs before retrying.",
        }),
        onTelemetry: (event) => console.info("himiko interaction lifecycle", event),
      });
    } catch {
      // The lifecycle owns result/error replies; this guard only protects the event loop.
    }
  });
});

client.on(Events.MessageCreate, (message) => {
  if (
    !identityVerified ||
    !message.guildId ||
    !allowed.includes(message.guildId) ||
    message.author.bot ||
    message.webhookId ||
    message.system ||
    Date.now() - message.createdTimestamp > 7 * 86400000 ||
    activeXp >= 32
  ) return;
  activeXp++;
  guarded("message-xp", async () => {
    try {
      if (!(await isControlEnabled(controlQuery, message.guildId!, botKey))) return;
      await community.awardXp({
        guildId: message.guildId!,
        userId: message.author.id,
        messageId: message.id,
        source: "message",
      });
    } finally {
      activeXp--;
    }
  });
});

client.on(Events.GuildMemberAdd, (member) => {
  if (!identityVerified || !allowed.includes(member.guild.id)) return;
  guarded("welcome", async () => {
    if (!(await isControlEnabled(controlQuery, member.guild.id, botKey))) return;
    await community.memberEvent({
      guildId: member.guild.id,
      userId: member.id,
      userName: member.user.username,
      guildName: member.guild.name,
      memberCount: member.guild.memberCount,
      event: "join",
      key: `join:${member.id}:${member.joinedTimestamp ?? Math.floor(Date.now() / 60000)}`,
    });
  });
});

client.on(Events.GuildMemberRemove, (member) => {
  if (!identityVerified || !allowed.includes(member.guild.id)) return;
  guarded("leave", async () => {
    if (!(await isControlEnabled(controlQuery, member.guild.id, botKey))) return;
    await community.memberEvent({
      guildId: member.guild.id,
      userId: member.id,
      userName: member.user.username,
      guildName: member.guild.name,
      memberCount: member.guild.memberCount,
      event: "leave",
      key: `leave:${member.id}:${member.joinedTimestamp ?? Math.floor(Date.now() / 60000)}`,
    });
  });
});

const voiceXpTimer = setInterval(() => guarded("voice-xp", async () => {
  if (!identityVerified || !client.isReady() || voiceXpPumping) return;
  voiceXpPumping = true;
  try {
    const batches: Array<{ guildId: string; intervalSeconds: number; users: string[]; offset: number; next: number }> = [];
    for (const guild of client.guilds.cache.values()) {
      if (!allowed.includes(guild.id) || !(await isControlEnabled(controlQuery, guild.id, botKey))) continue;
      const settings = await community.settings(guild.id);
      if (!settings.voiceXpEnabled) continue;
      const states = [...guild.voiceStates.cache.values()].flatMap((state) => {
        const member = state.member;
        if (!member) return [];
        return [{
          userId: member.id,
          channelId: state.channelId,
          isBot: member.user.bot,
          isAfk: state.channelId !== null && state.channelId === guild.afkChannelId,
          selfDeaf: Boolean(state.selfDeaf),
          serverDeaf: Boolean(state.serverDeaf),
        }];
      });
      const eligible = eligibleVoiceXpUsers(states);
      if (eligible.length === 0) continue;
      const offset = (voiceXpCursors.get(guild.id) ?? 0) % eligible.length;
      batches.push({
        guildId: guild.id,
        intervalSeconds: settings.voiceIntervalSeconds,
        users: [...eligible.slice(offset), ...eligible.slice(0, offset)],
        offset,
        next: 0,
      });
    }
    let attempts = 0;
    let awards = 0;
    const voicePollNow = Date.now();
    while (attempts < 64 && awards < 32 && activeXp < 32 && batches.some((batch) => batch.next < batch.users.length)) {
      for (const batch of batches) {
        if (attempts >= 64 || awards >= 32 || activeXp >= 32) break;
        const userId = batch.users[batch.next];
        if (!userId) continue;
        batch.next++;
        attempts++;
        activeXp++;
        try {
          const result = await community.awardXp({
            guildId: batch.guildId,
            userId,
            messageId: voiceXpEventKey(userId, voicePollNow, batch.intervalSeconds),
            source: "voice",
          });
          if (result.awarded) awards++;
        } finally {
          activeXp--;
        }
      }
    }
    for (const batch of batches) {
      voiceXpCursors.set(batch.guildId, (batch.offset + batch.next) % batch.users.length);
    }
  } finally {
    voiceXpPumping = false;
  }
}), 60_000);

client.on(Events.GuildCreate, (guild) => {
  if (!allowed.includes(guild.id)) guarded("leave-unapproved", () => guild.leave());
});

async function updateStatus(): Promise<void> {
  if (stopping || !identityVerified || !client.isReady() || pumping) return;
  pumping = true;
  try {
    // Himiko is the sole community outbox consumer and XP event retention owner after the bot handoff.
    for (const guildId of allowed) {
      try {
        if (await isControlEnabled(controlQuery, guildId, botKey)) {
          await applyCommunityConfiguration(pool, guildId, botKey);
        }
      } catch (error) {
        console.error(`himiko configuration update failed for guild ${guildId}:`, error instanceof Error ? error.message : String(error));
      }
    }
    await deliverCommunityMessages(pool, allowed, async (payload, nonce) => {
      if (!(await isControlEnabled(controlQuery, payload.guildId, botKey))) throw new Error("controls-disabled");
      const channel = await client.channels.fetch(payload.channelId);
      if (!channel || !channel.isTextBased() || !("guildId" in channel) || channel.guildId !== payload.guildId || !("send" in channel))
        throw new Error("channel-unavailable");
      const mention = payload.content.match(/<@!?(\d{17,20})>/)?.[1];
      await channel.send({
        ...toEiComponentPayload({ embeds: [createEiEmbed({ title: "Himiko · Community", description: payload.content })] }, "himiko"),
        allowedMentions: mention ? { users: [mention], roles: [], parse: [] } : { parse: [] },
        nonce,
        enforceNonce: true,
      });
    }, botKey);
    if (Date.now() - lastXpCleanup > 60 * 60_000) {
      lastXpCleanup = Date.now();
      await pool.query("DELETE FROM community.xp_events WHERE created_at<now()-interval '7 days'");
    }
    await pool.query(
      `INSERT INTO ops.service_status(service, liveness, gateway, db_ready, latency_ms)
       VALUES($1, 'ok', 'ok', true, $2)
       ON CONFLICT(service) DO UPDATE SET liveness='ok', gateway='ok', db_ready=true, latency_ms=EXCLUDED.latency_ms, updated_at=now()`,
      [`bot-${botKey}`, Math.max(0, Math.round(client.ws.ping))],
    );
    lastDbReady = true;
  } catch {
    lastDbReady = false;
  } finally {
    pumping = false;
  }
}

const statusTimer = setInterval(() => void updateStatus(), 5000);

const health = createServer((req, res) => {
  if (req.url === "/health/live") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-himiko", status: "alive" }));
    return;
  }
  if (req.url === "/health/ready") {
    const ready = identityVerified && client.isReady() && lastDbReady && !stopping;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-himiko", status: ready ? "ready" : "degraded" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
health.listen(Number(process.env.HIMIKO_HEALTH_PORT ?? 3107), "0.0.0.0");

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(statusTimer);
  clearInterval(voiceXpTimer);
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
    console.error("Error during bot-himiko shutdown:", err);
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
      body: [...commonCommandDefinitions(), ...himikoCommandDefinitions, ...communityCommandDefinitions].map((c) => c.toJSON()),
    });
    try {
      const reg = await pool.query("SELECT bot_key FROM config.bots WHERE bot_key = $1", [botKey]);
      if ((reg.rowCount ?? 0) === 0) console.warn(`himiko registry row missing for BOT_KEY=${botKey}`);
    } catch {
      // Retried by status loop.
    }
    await updateStatus();
    console.log(`bot-himiko ready as ${client.user?.tag} across ${client.guilds.cache.size} guilds`);
  });
});

await client.login(token);
