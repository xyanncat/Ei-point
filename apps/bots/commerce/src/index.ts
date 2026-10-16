import { createInteractionClaims, createWorkGate, dispatchGuildCommand, isControlEnabled, responsePolicy } from "@ei-point/flow";
import { createServer } from "node:http";
import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
  PermissionFlagsBits,
  Routes,
} from "discord.js";
import pg from "pg";
import { catalogChoices, commerceCommandDefinitions, respondToCommerceCommand } from "./commands.js";
import { canSettleCommerce } from "./authorization.js";
import { commonCommandDefinitions, respondToCommonCommand, withEiEmbedReplies } from "@ei-point/module-bot-ui";

const botKey = process.env.BOT_KEY ?? "cipher";
const url = process.env.DATABASE_URL;
const token = process.env.BOT_TOKEN ?? process.env.DISCORD_CIPHER_BOT_TOKEN ?? process.env.DISCORD_COMMERCE_BOT_TOKEN;
const rawAllowlist =
  process.env.GUILD_ALLOWLIST ??
  process.env.COMMUNITY_GUILD_ALLOWLIST ??
  [process.env.DISCORD_TEST_GUILD_ID, process.env.DISCORD_MAIN_GUILD_ID].filter(Boolean).join(",");
const allowed = rawAllowlist
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

if (!url || !token || allowed.length !== 2 || allowed.some((x) => !/^\d{17,20}$/.test(x))) {
  throw new Error("Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST (exactly two guild IDs) before starting the commerce bot.");
}

const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  application_name: "bot-commerce",
});
pool.on("error", () => console.error("commerce database connection interrupted"));
process.on("unhandledRejection", (err) => console.error("unhandledRejection in bot-commerce:", err));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  makeCache: Options.cacheWithLimits({ MessageManager: 0 }),
});

let stopping = false;
let identityVerified = false;
let lastDbReady = false;
// Bounded real-work admission: a slot is held until the command's work settles.
const commandGate = createWorkGate(20);
const interactionClaims = createInteractionClaims();

const guarded = (label: string, run: () => Promise<unknown>) => {
  void run().catch((err) =>
    console.error(`commerce ${label} failed:`, err instanceof Error ? err.message : String(err)),
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

// --- Interaction Handler ---
client.on(Events.InteractionCreate, (rawInteraction) => {
  if (rawInteraction.isAutocomplete()) {
    if (rawInteraction.commandName === "orders" && rawInteraction.options.getFocused(true).name === "sku") {
      guarded("autocomplete", async () => {
        await rawInteraction.respond(await catalogChoices(pool, String(rawInteraction.options.getFocused() ?? "")));
      });
      return;
    }
    guarded("autocomplete", () => rawInteraction.respond([]));
    return;
  }
  if (!rawInteraction.isChatInputCommand()) return;
  const interaction = withEiEmbedReplies(rawInteraction, responsePolicy(botKey, rawInteraction.commandName).imageKey);
  if (!identityVerified) {
    guarded("not-ready", () =>
      interaction.reply({ content: "Commerce bot is initializing. Please retry in a moment.", ephemeral: true }),
    );
    return;
  }

  guarded("command", async () => {
    try {
      if (interaction.inCachedGuild() && await respondToCommonCommand(interaction, "Cipher", "Orders, referrals, and payment setup.")) return;
      let userScopes: string[] = [];
      const canManage = interaction.inCachedGuild() && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
      const isOwner = interaction.inCachedGuild() && interaction.guild.ownerId === interaction.user.id;
      await dispatchGuildCommand({
        botKey,
        allowlist: allowed,
        interaction,
        operationId: interaction.id,
        operation: interaction.commandName,
        gate: commandGate,
        claims: interactionClaims,
        authorize: async () => {
          if (!interaction.inCachedGuild()) return { content: "Commerce commands are only available in an approved server." };
          const memberRoleIds = [...interaction.member.roles.cache.keys()];
          if (!(await isControlEnabled(async (sql, params) => (await pool.query(sql, params)).rows,
            interaction.guildId, botKey, interaction.commandName, memberRoleIds))) {
            return { content: "This bot, server, or command is disabled for your roles." };
          }
          const identity = (await pool.query("SELECT application_id FROM config.bots WHERE bot_key=$1", [botKey])).rows[0];
          if (identity?.application_id !== client.user!.id) return { content: "Registered bot identity is unavailable." };
          userScopes = await loadStaffScopes(interaction.guildId, memberRoleIds);
          if (interaction.commandName === "orders" && ["settle", "review", "reject"].includes(interaction.options.getSubcommand(false) ?? "") && !canSettleCommerce({ isOwner, canManage, userScopes })) {
            return { content: "❌ Permission denied: `commerce-settle` role or Manage Server required." };
          }
          return undefined;
        },
        run: async (ctx) => {
          if (!interaction.inCachedGuild()) throw new Error("guild context unavailable");
          ctx.signal.throwIfAborted();
          const options: Record<string, string | number | boolean> = {};
          for (const opt of interaction.options.data) {
            if (opt.value !== undefined) options[opt.name] = opt.value;
            if (opt.options) for (const subOpt of opt.options) {
              if (subOpt.value !== undefined) options[subOpt.name] = subOpt.value;
            }
          }
          let response: string | undefined;
          await respondToCommerceCommand({
            name: interaction.commandName,
            subcommand: interaction.options.getSubcommand(false) ?? undefined,
            options,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            key: interaction.id,
            isOwner,
            canManage,
            userScopes,
            paymentOrigin: process.env.PAYMENT_ORIGIN ?? "",
            payeeVpa: process.env.UPI_PAYEE_VPA ?? "",
            payeeName: process.env.UPI_PAYEE_NAME ?? "",
            usdtAddress: process.env.USDT_TRC20_ADDRESS ?? "",
            defer: async () => {},
            reply: async (text) => { response = text; },
          }, pool);
          return { content: (response ?? "Command completed without a response.").slice(0, 2000), allowedMentions: { parse: [] as string[] } };
        },
        failureReply: (category) => ({
          content: category === "auth" ? "This server is not approved for commerce bot."
            : category === "permissions" ? "This bot, server, or command is disabled for your roles."
              : category === "duplicate" ? "This interaction is already being processed. Check your order status before retrying."
                : category === "shutting-down" ? "The commerce bot is shutting down. Please retry in a moment."
                  : category === "queue-full" ? "Commerce service is busy. Please retry shortly."
                    : category === "timeout" ? "Commerce outcome is unconfirmed. Check your order status before retrying."
                      : "Commerce outcome is unconfirmed. Check your order status before retrying.",
          allowedMentions: { parse: [] as string[] },
        }),
        onTelemetry: (event) => console.info("commerce interaction lifecycle", event),
      });
    } catch {
      console.error("commerce command dispatch failed; inspect service diagnostics");
    }
  });
});

client.on(Events.GuildCreate, (guild) => {
  if (!allowed.includes(guild.id)) guarded("leave-unapproved", () => guild.leave());
});

async function updateStatus(): Promise<void> {
  if (stopping || !identityVerified || !client.isReady()) return;
  try {
    await pool.query(
      `INSERT INTO ops.service_status(service, liveness, gateway, db_ready, latency_ms)
       VALUES($2, 'ok', 'ok', true, $1)
       ON CONFLICT(service) DO UPDATE SET liveness='ok', gateway='ok', db_ready=true, latency_ms=EXCLUDED.latency_ms, updated_at=now()`,
      [Math.max(0, Math.round(client.ws.ping)),`bot-${botKey}`],
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
    res.end(JSON.stringify({ service: "bot-commerce", status: "alive" }));
    return;
  }
  if (req.url === "/health/ready") {
    const ready = identityVerified && client.isReady() && lastDbReady && !stopping;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "bot-commerce", status: ready ? "ready" : "degraded" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
health.listen(Number(process.env.COMMERCE_HEALTH_PORT ?? 3106), "0.0.0.0");

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(statusTimer);
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
    console.error("Error during bot-commerce shutdown:", err);
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

client.once(Events.ClientReady, () => {
  guarded("startup", async () => {
    const identity=(await pool.query("SELECT application_id FROM config.bots WHERE bot_key=$1",[botKey])).rows[0];
    if(identity?.application_id!==client.user!.id){await shutdown();return;}
    identityVerified = true;
    for (const guild of client.guilds.cache.values()) {
      if (!allowed.includes(guild.id)) {
        await guild.leave();
        continue;
      }
      await client.rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: [...commonCommandDefinitions(), ...commerceCommandDefinitions].map((c) => c.toJSON()),
      });
    }
    await updateStatus();
    console.log(`bot-commerce ready as ${client.user?.tag} across ${client.guilds.cache.size} guilds`);
  });
});

await client.login(token);
