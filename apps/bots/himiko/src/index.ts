import { deliverAnnouncement } from "./delivery.js";
import { dispatchGuildCommand, isControlEnabled } from "@ei-point/flow";
// Himiko: embed messages & announcements gateway (identity `himiko`).
// Slash commands for staff announcements + embed previews. Scheduled
// dashboard embeds continue through the workers outbox; this process owns
// interactive /announce and /embed with guild allowlist + staff gating.

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
import { commonCommandDefinitions, respondToCommonCommand, withEiEmbedReplies } from "@ei-point/module-bot-ui";

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
pool.on("error", () => console.error("himiko database connection interrupted"));
process.on("unhandledRejection", (err) => console.error("unhandledRejection in bot-himiko:", err));

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  makeCache: Options.cacheWithLimits({ MessageManager: 0 }),
});

let stopping = false;
let identityVerified = false;
let lastDbReady = false;
let activeCommands = 0;

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
  const interaction = withEiEmbedReplies(rawInteraction);
  if (!interaction.isChatInputCommand()) return;
  if (!identityVerified) {
    guarded("not-ready", () =>
      interaction.reply({ content: "Himiko is initializing. Please retry in a moment.", ephemeral: true }),
    );
    return;
  }
  if (activeCommands >= 20) {
    guarded("busy", () =>
      interaction.reply({ content: "Himiko service is busy. Please retry shortly.", ephemeral: true }),
    );
    return;
  }
  activeCommands++;
  guarded("command", async () => {
    try {
      if (interaction.inCachedGuild() && await respondToCommonCommand(interaction, "Himiko", "Announcements, embed publishing, welcome and leave messages, and text and voice XP.")) return;
      let guildGrant = false;
      await dispatchGuildCommand({
        botKey,
        allowlist: allowed,
        interaction,
        authorize: async () => {
          if (!interaction.inCachedGuild()) return { content: "Himiko commands are only available in an approved server." };
          const memberRoleIds = [...interaction.member.roles.cache.keys()];
          if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows,
            interaction.guildId, botKey, interaction.commandName, memberRoleIds))) {
            return { content: "This command is disabled, paused, or restricted by server controls." };
          }
          const scopes = await loadStaffScopes(interaction.guildId, memberRoleIds);
          // Guild grants may bypass channel Manage Messages; destination checks still apply below.
          guildGrant = interaction.guild.ownerId === interaction.user.id || scopes.includes("announce") || scopes.includes("*");
          const guildManage = interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages);
          return guildGrant || guildManage
            ? undefined
            : { content: "Permission denied: Manage Messages or announce staff scope required." };
        },
        run: async (signal) => {
          signal.throwIfAborted();
          if (!interaction.inCachedGuild()) throw new Error("guild context unavailable");
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
          const embed = new EmbedBuilder().setTitle(payload.title).setDescription(payload.description)
            .setColor(parseInt(String(payload.color).slice(1), 16));
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
          signal.throwIfAborted();
          await deliverAnnouncement(async(sql,args)=>(await pool.query(sql,args)).rows, interaction.id,
            { ...payload, by: interaction.user.id, guild_id: interaction.guildId }, async nonce => {
              await target.send({
                ...(payload.content ? { content: payload.content } : {}),
                embeds: [embed],
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
              : category === "timeout"
                ? "Himiko operation outcome is unconfirmed. Check its status before retrying."
                : "Himiko operation outcome is unconfirmed. Inspect system logs before retrying.",
        }),
        onTelemetry: (event) => console.info("himiko interaction lifecycle", event),
      });
    } catch {
      // The lifecycle owns result/error replies; this guard only protects the event loop.
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
        body: [...commonCommandDefinitions(), ...himikoCommandDefinitions].map((c) => c.toJSON()),
      });
    });
  }
});

async function updateStatus(): Promise<void> {
  if (stopping || !identityVerified || !client.isReady()) return;
  try {
    await pool.query(
      `INSERT INTO ops.service_status(service, liveness, gateway, db_ready, latency_ms)
       VALUES($1, 'ok', 'ok', true, $2)
       ON CONFLICT(service) DO UPDATE SET liveness='ok', gateway='ok', db_ready=true, latency_ms=EXCLUDED.latency_ms, updated_at=now()`,
      [`bot-${botKey}`, Math.max(0, Math.round(client.ws.ping))],
    );
    lastDbReady = true;
  } catch {
    lastDbReady = false;
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
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  try {
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
        if (!allowed.includes(guild.id)) {
          await guild.leave();
          continue;
        }
        await client.rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
          body: [...commonCommandDefinitions(), ...himikoCommandDefinitions].map((c) => c.toJSON()),
        });
      } catch (err) {
        console.error(`Failed setup for guild ${guild.id}:`, err);
      }
    }
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
