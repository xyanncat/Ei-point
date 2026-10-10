// Phase 2 stub: bot entry validates config + guild allowlist, logs in. Full lifecycle in Phase 3.
import { Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "@ei-royality/runtime";

const BOT_KEY = "security";
const config = loadConfig(BOT_KEY);
if (config.BOT_TOKEN == null) {
  console.error(`${BOT_KEY}: BOT_TOKEN is not set (see .env.example)`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration] });
client.once("ready", () => console.log(`${BOT_KEY} ready as ${client.user?.tag}`));
await client.login(config.BOT_TOKEN);
