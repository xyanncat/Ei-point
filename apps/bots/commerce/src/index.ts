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
import { commerceCommandDefinitions, respondToCommerceCommand } from "./commands.js";

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

if (!url || !token || !allowed.length || allowed.some((x) => !/^\d{17,20}$/.test(x))) {
  throw new Error("Set DATABASE_URL, BOT_TOKEN and GUILD_ALLOWLIST before starting the commerce bot.");
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
let activeCommands = 0;

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
client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!identityVerified) {
    guarded("not-ready", () =>
      interaction.reply({ content: "Commerce bot is initializing. Please retry in a moment.", ephemeral: true }),
    );
    return;
  }

  if (activeCommands >= 20) {
    guarded("busy", () =>
      interaction.reply({ content: "Commerce service is busy. Please retry shortly.", ephemeral: true }),
    );
    return;
  }

  activeCommands++;
  guarded("command", async () => {
    try {
      if (!interaction.inCachedGuild() || !allowed.includes(interaction.guildId)) {
        await interaction.reply({ content: "This server is not approved for commerce bot.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const options: Record<string, string | number | boolean> = {};
      for (const opt of interaction.options.data) {
        if (opt.value !== undefined) options[opt.name] = opt.value;
        if (opt.options) {
          for (const subOpt of opt.options) {
            if (subOpt.value !== undefined) options[subOpt.name] = subOpt.value;
          }
        }
      }

      const memberRoleIds = [...interaction.member.roles.cache.keys()];
      const userScopes = await loadStaffScopes(interaction.guildId, memberRoleIds);

      const sub = interaction.options.getSubcommand(false) ?? undefined;

      await respondToCommerceCommand(
        {
          name: interaction.commandName,
          subcommand: sub,
          options,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          key: interaction.id,
          isOwner: interaction.guild.ownerId === interaction.user.id,
          canManage: interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
          userScopes,
          paymentOrigin: process.env.PAYMENT_ORIGIN ?? "http://localhost:3000",
          payeeVpa: process.env.UPI_PAYEE_VPA ?? "payments@upi",
          payeeName: process.env.UPI_PAYEE_NAME ?? "Ei Point",
          usdtAddress: process.env.USDT_TRC20_ADDRESS ?? "",
          defer: async () => {},
          reply: async (text) => {
            await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
          },
        },
        pool,
      );
    } catch (err) {
      if (interaction.deferred) {
        await interaction
          .editReply({ content: "Commerce operation failed safely. Please retry." })
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
    await pool.query(
      `INSERT INTO ops.service_status(service, liveness, gateway, db_ready, latency_ms)
       VALUES('bot-commerce', 'ok', 'ok', true, $1)
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
    identityVerified = true;
    for (const guild of client.guilds.cache.values()) {
      if (!allowed.includes(guild.id)) {
        await guild.leave();
        continue;
      }
      await client.rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: commerceCommandDefinitions.map((c) => c.toJSON()),
      });
    }
    await updateStatus();
    console.log(`bot-commerce ready as ${client.user?.tag} across ${client.guilds.cache.size} guilds`);
  });
});

await client.login(token);
