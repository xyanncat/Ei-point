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

if (!url || !token || !allowed.length || allowed.some((x) => !/^\d{17,20}$/.test(x))) {
  throw new Error("Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST before starting the himiko bot.");
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

client.on(Events.InteractionCreate, (interaction) => {
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
      if (!interaction.inCachedGuild() || !allowed.includes(interaction.guildId)) {
        await interaction.reply({ content: "This server is not approved for Himiko.", ephemeral: true });
        return;
      }
      // Defer before any DB work: slow queries must not breach the 3s ack window.
      await interaction.deferReply({ ephemeral: true });
      const memberRoleIds = [...interaction.member.roles.cache.keys()];
      const scopes = await loadStaffScopes(interaction.guildId, memberRoleIds);
      // Guild-level grants (owner / staff scope). Channel-scoped Discord
      // permissions are checked per command below against the destination.
      const guildGrant =
        interaction.guild.ownerId === interaction.user.id ||
        scopes.includes("announce") ||
        scopes.includes("*");
      const guildManage = interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages);
      if (!guildGrant && !guildManage) {
        await interaction.editReply("Permission denied: Manage Messages or announce staff scope required.");
        return;
      }

      if (interaction.commandName === "embed") {
        const title = String(interaction.options.getString("title", true));
        const description = String(interaction.options.getString("description", true));
        const color = interaction.options.getString("color") ?? "#B6A0FF";
        const checked = validateAnnounceInput({
          channelId: interaction.channelId!,
          title,
          description,
          color,
        });
        if (!checked.ok) {
          await interaction.editReply(`Invalid embed: ${checked.reason}.`);
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle(checked.value.title)
          .setDescription(checked.value.description)
          .setColor(parseInt(checked.value.color!.slice(1), 16));
        await interaction.editReply({ content: "Preview (only you can see this):", embeds: [embed] });
        return;
      }

      if (interaction.commandName === "announce") {
        const channel = interaction.options.getChannel("channel", true);
        const title = String(interaction.options.getString("title", true));
        const description = String(interaction.options.getString("description", true));
        const color = interaction.options.getString("color") ?? undefined;
        const pingRole = interaction.options.getRole("ping_role") ?? undefined;
        const checked = validateAnnounceInput({
          channelId: channel.id,
          title,
          description,
          ...(color ? { color } : {}),
          ...(pingRole ? { pingRoleId: pingRole.id } : {}),
        });
        if (!checked.ok) {
          await interaction.editReply(`Invalid announcement: ${checked.reason}.`);
          return;
        }
        const payload = buildAnnouncePayload(interaction.guildId, checked.value);
        const embed = new EmbedBuilder()
          .setTitle(payload.title)
          .setDescription(payload.description)
          .setColor(parseInt(String(payload.color).slice(1), 16));
        const target = await interaction.guild.channels.fetch(payload.channel_id).catch(() => null);
        if (!target || !target.isTextBased() || !("send" in target)) {
          await interaction.editReply("Destination channel is not a sendable text channel.");
          return;
        }
        // Caller and bot permissions resolved against the DESTINATION channel
        // (guild-level flags do not account for channel overwrites).
        const callerPerms =
          target && "permissionsFor" in target ? target.permissionsFor(interaction.member) : null;
        // /announce requires Manage Messages in the DESTINATION channel unless
        // covered by the guild-level owner/scope grant above.
        if (!guildGrant && !callerPerms?.has(PermissionFlagsBits.ManageMessages)) {
          await interaction.editReply("Permission denied: Manage Messages is required in the destination channel.");
          return;
        }
        // Bot must be able to post embeds in the destination channel.
        const me = interaction.guild.members.me;
        const perms = me && "permissionsFor" in target ? target.permissionsFor(me) : null;
        if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
          await interaction.editReply("Himiko cannot post there: missing Send Messages / Embed Links in that channel.");
          return;
        }
        // Role pings require either a mentionable role or Mention Everyone
        // in the destination channel.
        if (checked.value.pingRoleId) {
          const canMention =
            callerPerms?.has(PermissionFlagsBits.MentionEveryone) === true ||
            pingRole?.mentionable === true;
          if (!canMention) {
            await interaction.editReply("That role is not mentionable and you lack Mention Everyone there.");
            return;
          }
        }
        await target.send({
          ...(payload.content ? { content: payload.content } : {}),
          embeds: [embed],
          allowedMentions: payload.content ? { roles: [checked.value.pingRoleId!] } : { parse: [] },
        });
        // Audit-only: the announcement is already delivered, so an outbox
        // failure must not flip the user-visible result to failure.
        try {
          await pool.query(
            `INSERT INTO ops.outbox (aggregate, aggregate_id, type, payload, correlation_id)
             VALUES ('announce', $1, 'announce.sent', $2, $3) ON CONFLICT DO NOTHING`,
            [interaction.guildId, JSON.stringify({ ...payload, by: interaction.user.id }), interaction.id],
          );
        } catch (err) {
          console.warn("himiko announce audit insert failed:", err instanceof Error ? err.message : String(err));
        }
        await interaction.editReply(`Announcement posted to <#${payload.channel_id}>.`);
        return;
      }

      await interaction.editReply("Unknown Himiko command.");
    } catch (err) {
      console.error("himiko command failed:", err instanceof Error ? err.message : String(err));
      if (interaction.deferred) {
        await interaction.editReply({ content: "Himiko operation failed safely." }).catch(() => {});
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
        body: himikoCommandDefinitions.map((c) => c.toJSON()),
      });
    });
  }
});

async function updateStatus(): Promise<void> {
  if (stopping || !identityVerified || !client.isReady()) return;
  try {
    await pool.query(
      `INSERT INTO ops.service_status(service, liveness, gateway, db_ready, latency_ms)
       VALUES('bot-himiko', 'ok', 'ok', true, $1)
       ON CONFLICT(service) DO UPDATE SET liveness='ok', gateway='ok', db_ready=true, latency_ms=EXCLUDED.latency_ms, updated_at=now()`,
      [Math.max(0, Math.round(client.ws.ping))],
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
    identityVerified = true;
    for (const guild of client.guilds.cache.values()) {
      try {
        if (!allowed.includes(guild.id)) {
          await guild.leave();
          continue;
        }
        await client.rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
          body: himikoCommandDefinitions.map((c) => c.toJSON()),
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
