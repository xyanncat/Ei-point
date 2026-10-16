import { createServer } from "node:http";
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  Routes,
} from "discord.js";
import pg from "pg";
import { CommunityService } from "@ei-point/module-community";
import { EconomyService } from "@ei-point/module-games";
import { commandDefinitions, respondToCommand } from "./commands.js";
import { communityCommandPermissionDenial } from "./authorization.js";
import { commonCommandDefinitions, respondToCommonCommand, withEiEmbedReplies } from "@ei-point/module-bot-ui";
import {
  createInteractionClaims,
  createWorkGate,
  dispatchGuildCommand,
  isControlEnabled,
} from "@ei-point/flow";
const botKey = process.env.BOT_KEY ?? "silverwolf";

const url = process.env.DATABASE_URL,
  token = process.env.BOT_TOKEN ?? process.env.DISCORD_SILVERWOLF_BOT_TOKEN ?? process.env.DISCORD_COMMUNITY_BOT_TOKEN;
const allowed = (process.env.GUILD_ALLOWLIST ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
if (
  !url ||
  !token ||
  allowed.length !== 2 ||
  allowed.some((x) => !/^\d{17,20}$/.test(x))
)
  throw new Error(
    "Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST (exactly two guild IDs) before starting the community bot.",
  );
const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  application_name: "bot-community",
});
pool.on("error", () =>
  console.error("community database connection interrupted"),
);
process.on("unhandledRejection", (err) =>
  console.error("unhandledRejection in bot-community:", err),
);
// This legacy `bot-community` process is SilverWolf's games gateway; Himiko now owns member events, XP awards, and community outbox delivery.
const community = new CommunityService(pool),
  economy = new EconomyService(pool);
const controlQuery = async (sql: string, params?: unknown[]) =>
  (await pool.query(sql, params)).rows;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});
let stopping = false,
  pumping: Promise<void> | null = null,
  lastMaintenance = 0,
  lastDbReady = false;
let identityVerified = false;
// Bounded real-work admission: a slot is held until the command's work settles.
const commandGate = createWorkGate(20);
const interactionClaims = createInteractionClaims();
const guarded = (label: string, run: () => Promise<unknown>) => {
  void run().catch(() =>
    console.error(`community ${label} failed; inspect service diagnostics`),
  );
};

client.on(Events.InteractionCreate, (rawInteraction) => {
  const interaction = withEiEmbedReplies(rawInteraction);
  if (!interaction.isChatInputCommand()) return;
  if (!identityVerified) {
    guarded("identity-not-ready", () =>
      interaction.reply({
        content:
          "The registered bot identity is not ready. Please retry shortly.",
        ephemeral: true,
      }),
    );
    return;
  }
  guarded("command", async () => {
    try {
      if (interaction.inCachedGuild() && await respondToCommonCommand(interaction, "SilverWolf", "Card games, collectibles, berries, trading, and rank profiles.")) return;
      await dispatchGuildCommand({
        botKey,
        allowlist: allowed,
        interaction,
        operationId: interaction.id,
        gate: commandGate,
        claims: interactionClaims,
        authorize: async () => {
          if (!interaction.inCachedGuild()) return { content: "This server is not approved." };
          if (!(await isControlEnabled(controlQuery, interaction.guildId, botKey,
            interaction.commandName, [...interaction.member.roles.cache.keys()]))) {
            return { content: "This bot, server, or command is disabled for your roles." };
          }
          const commandDenial = communityCommandPermissionDenial(
            interaction.commandName,
            interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
            interaction.guild.ownerId === interaction.user.id,
          );
          if (commandDenial) return { content: commandDenial };
          return undefined;
        },
        run: async (ctx) => {
          if (!interaction.inCachedGuild()) throw new Error("guild context unavailable");
          ctx.signal.throwIfAborted();
          const options: Record<string, string | number | boolean> = {};
          const flatten = (values: typeof interaction.options.data): void => {
            for (const option of values) {
              if (option.value !== undefined) options[option.name] = option.value;
              if (option.options) flatten(option.options);
            }
          };
          flatten(interaction.options.data);
          options.username = interaction.user.username;
          options.guild_name = interaction.guild.name;
          options.member_count = interaction.guild.memberCount;
          const sub = interaction.options.getSubcommand(false);
          let response: string | undefined;
          await respondToCommand({
            name: interaction.commandName,
            ...(sub ? { subcommand: sub } : {}),
            options,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            key: interaction.id,
            isOwner: interaction.guild.ownerId === interaction.user.id,
            canManage: interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
            defer: async () => {},
            reply: async (content) => { response = content; },
          }, { community, economy });
          return { content: (response ?? "Command completed without a response.").slice(0, 2000), allowedMentions: { parse: [] as string[] } };
        },
        failureReply: (category) => ({
          content: category === "auth" ? "This server is not approved."
            : category === "permissions" ? "This bot, server, or command is disabled for your roles."
              : category === "duplicate" ? "This interaction is already being processed. Check its result before retrying."
                : category === "shutting-down" ? "The community bot is shutting down. Please retry in a moment."
                  : category === "queue-full" ? "The community bot is busy. Please retry shortly."
                    : category === "timeout" ? "The outcome is unconfirmed. Check the operation before retrying."
                      : "Server controls are temporarily unavailable. Check the operation before retrying.",
          allowedMentions: { parse: [] as string[] },
        }),
        onTelemetry: (event) => console.info("community interaction lifecycle", event),
      });
    } catch {
      console.error("community command dispatch failed; inspect service diagnostics");
    }
  });
});
client.on(Events.GuildCreate, (guild) => {
  if (!allowed.includes(guild.id))
    guarded("leave-unapproved", () => guild.leave());
});
client.on(Events.Error, () => console.error("community Discord gateway error"));

async function pump(): Promise<void> {
  if (stopping || pumping || !identityVerified || !client.isReady()) return;
  pumping = (async () => {
    if (Date.now() - lastMaintenance > 60000) {
      lastMaintenance = Date.now();
      for (const guildId of allowed) {
        const row = (
          await pool.query(
            "SELECT approved FROM access.guilds WHERE guild_id=$1",
            [guildId],
          )
        ).rows[0];
        if (
          row?.approved &&
          (await isControlEnabled(controlQuery, guildId, botKey))
        )
          await economy.expireTrades(guildId);
      }
    }
    await pool.query(
      `INSERT INTO ops.service_status(service,liveness,gateway,db_ready,latency_ms) VALUES($1,'ok','ok',true,$2)
      ON CONFLICT(service) DO UPDATE SET liveness='ok',gateway='ok',db_ready=true,latency_ms=EXCLUDED.latency_ms,updated_at=now()`,
      [`bot-${botKey}`, Math.max(0, Math.round(client.ws.ping))],
    );
    lastDbReady = true;
  })();
  try {
    await pumping;
  } catch {
    lastDbReady = false;
    console.error("community maintenance unavailable");
  } finally {
    pumping = null;
  }
}

const health = createServer((req, res) => {
  if (req.url === "/health/live") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-community", status: "alive" }));
    return;
  }
  if (req.url === "/health/ready") {
    const ready =
      identityVerified && client.isReady() && lastDbReady && !stopping;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-community", status: ready ? "ready" : "degraded" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
health.listen(Number(process.env.COMMUNITY_HEALTH_PORT ?? 3103), "0.0.0.0");
const timer = setInterval(() => {
  void pump();
}, 5000);
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  try {
    commandGate.close();
    await commandGate.drain(10000);
    await pumping?.catch(() => {});
    client.destroy();
    health.close();
    await pool.end();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    console.error("Error during bot-community shutdown:", err);
    clearTimeout(timeout);
    process.exit(1);
  }
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
await pool.query("SELECT reservation_id FROM games.card_instances LIMIT 0"); // Fail startup if Phase 6 migration is missing.
client.once(Events.ClientReady, () =>
  guarded("registration", async () => {
    const identity = (
      await pool.query(
        "SELECT application_id FROM config.bots WHERE bot_key=$1",
        [botKey],
      )
    ).rows[0];
    if (identity?.application_id !== client.user!.id) {
      console.error(
        "community token identity does not match the registered BOT_KEY",
      );
      await shutdown();
      return;
    }
    identityVerified = true;
    for (const guild of client.guilds.cache.values()) {
      if (!allowed.includes(guild.id)) {
        await guild.leave();
        continue;
      }
      const approved = (
        await pool.query(
          "SELECT approved FROM access.guilds WHERE guild_id=$1",
          [guild.id],
        )
      ).rows[0]?.approved;
      if (approved !== true) continue;
      await client.rest.put(
        Routes.applicationGuildCommands(client.user!.id, guild.id),
        { body: [...commonCommandDefinitions(), ...commandDefinitions.filter((c) => ["rank", "cards", "inventory", "balance", "packs", "open", "buy", "sell", "market", "trade"].includes(c.name))].map((c) => c.toJSON()) },
      );
    }
    await pump();
  }),
);
await client.login(token);
