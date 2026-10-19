#!/usr/bin/env node
// Reconcile duplicate Discord application-command registrations.
// Default is a READ-ONLY dry run. --apply deletes only exact redundant guild
// copies that match the global definition; it never bulk-overwrites commands.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://discord.com/api/v10";
const TOKEN_VAR = {
  kafka: "KAFKA",
  cyrene: "CYRENE",
  robin: "ROBIN",
  cipher: "CIPHER",
  silverwolf: "SILVERWOLF",
  himiko: "HIMIKO",
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function loadEnv(text) {
  const env = {};
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

export function commandKey(command) {
  return `${command.type}:${command.name}`;
}

/** Only fields that define the user-visible command contract. IDs/versions differ per scope. */
export function comparableDefinition(command) {
  return {
    type: command.type,
    name: command.name,
    description: command.description ?? "",
    options: command.options ?? [],
    default_member_permissions: command.default_member_permissions ?? null,
    dm_permission: command.dm_permission ?? null,
    contexts: command.contexts ?? null,
    integration_types: command.integration_types ?? null,
    nsfw: command.nsfw ?? false,
  };
}

export function definitionsMatch(globalCommand, guildCommand) {
  return JSON.stringify(comparableDefinition(globalCommand)) === JSON.stringify(comparableDefinition(guildCommand));
}

/**
 * Pure plan builder. `blockedCommandIds` are guild command IDs with permission
 * overrides that cannot be safely recreated; they are never deletion candidates.
 */
export function planReconciliation({ globalCommands, guildCommands, guildId, blockedCommandIds = [] }) {
  const blocked = new Set(blockedCommandIds);
  const globalByKey = new Map(globalCommands.map((command) => [commandKey(command), command]));
  const redundant = [];
  const mismatched = [];
  const guildOnly = [];
  const permissionBlocked = [];
  for (const guildCommand of guildCommands) {
    const key = commandKey(guildCommand);
    const globalCommand = globalByKey.get(key);
    if (!globalCommand) {
      guildOnly.push({ key, guildId, guildIdValue: guildCommand.id, name: guildCommand.name, type: guildCommand.type });
      continue;
    }
    if (blocked.has(guildCommand.id)) {
      permissionBlocked.push({ key, guildId, globalId: globalCommand.id, guildIdValue: guildCommand.id, name: guildCommand.name, type: guildCommand.type });
      continue;
    }
    if (definitionsMatch(globalCommand, guildCommand)) {
      redundant.push({ key, guildId, globalId: globalCommand.id, guildIdValue: guildCommand.id, name: guildCommand.name, type: guildCommand.type });
    } else {
      mismatched.push({ key, guildId, globalId: globalCommand.id, guildIdValue: guildCommand.id, name: guildCommand.name, type: guildCommand.type });
    }
  }
  return { redundant, mismatched, guildOnly, permissionBlocked };
}

async function discordRequest(token, path, options = {}, attempt = 0) {
  const headers = {
    Authorization: `Bot ${token}`,
    "User-Agent": "EiPointCommandReconcile/1",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
  };
  const response = await fetch(`${API}${path}`, { ...options, headers });
  if (response.status === 429 && attempt < 3) {
    const body = await response.json().catch(() => ({}));
    await sleep(Math.max(250, Number(body.retry_after ?? 1) * 1000));
    return discordRequest(token, path, options, attempt + 1);
  }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function readRegistry() {
  const out = execFileSync(
    "docker",
    ["exec", "ei-point-postgres-1", "sh", "-c", 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT bot_key, application_id FROM config.bots ORDER BY bot_key"'],
    { encoding: "utf8", timeout: 20000 },
  );
  return new Map(
    out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, id] = line.split("|");
        return [key?.trim(), id?.trim()];
      })
      .filter(([key, id]) => key && /^\d{17,20}$/.test(id ?? "")),
  );
}

async function fetchGuildPermissions(token, appId, guildId) {
  try {
    const value = await discordRequest(token, `/applications/${appId}/guilds/${guildId}/commands/permissions`);
    return { status: "ok", overrides: Array.isArray(value) ? value : [] };
  } catch (error) {
    return { status: "unavailable", error: String(error.message ?? error), overrides: [] };
  }
}

async function snapshot(directory, name, value) {
  const file = resolve(directory, name);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const envPath = args.find((arg) => arg.startsWith("--env="))?.slice("--env=".length) ?? "/opt/ei-point/.env";
  const env = loadEnv(await readFile(envPath, "utf8"));
  const guilds = [...new Set([env.DISCORD_TEST_GUILD_ID, env.DISCORD_MAIN_GUILD_ID].filter((id) => /^\d{17,20}$/.test(id ?? "")))];
  if (!guilds.length) throw new Error("No approved guild IDs configured (DISCORD_TEST_GUILD_ID / DISCORD_MAIN_GUILD_ID)");
  const registry = readRegistry();
  if (!registry.size) throw new Error("Bot registry is empty; refusing to reconcile");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = `/root/command-snapshots/${stamp}`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => {});

  const report = { mode: apply ? "apply" : "dry-run", timestamp: new Date().toISOString(), guilds, bots: {}, changes: [] };
  for (const [botKey, appId] of registry) {
    const tokenVar = TOKEN_VAR[botKey];
    const token = tokenVar ? env[`DISCORD_${tokenVar}_BOT_TOKEN`] : undefined;
    if (!token) {
      report.bots[botKey] = { status: "skipped", reason: "missing token" };
      continue;
    }
    const me = await discordRequest(token, "/users/@me");
    if (String(me.id) !== String(appId)) {
      report.bots[botKey] = { status: "blocked", reason: "token identity does not match registry application_id" };
      continue;
    }
    const globalCommands = await discordRequest(token, `/applications/${appId}/commands`);
    await snapshot(directory, `${botKey}-global.json`, globalCommands);
    const bot = { status: "ok", appId, global: globalCommands.length, guilds: {}, redundant: [], mismatched: [], guildOnly: [], permissionBlocked: [], permissionsStatus: {} };
    for (const guildId of guilds) {
      let guildCommands;
      try {
        guildCommands = await discordRequest(token, `/applications/${appId}/guilds/${guildId}/commands`);
      } catch (error) {
        if (/HTTP (403|404)/.test(String(error.message))) {
          bot.guilds[guildId] = { status: "not-installed" };
          continue;
        }
        throw error;
      }
      await snapshot(directory, `${botKey}-guild-${guildId}.json`, guildCommands);
      const permissions = await fetchGuildPermissions(token, appId, guildId);
      bot.permissionsStatus[guildId] = permissions.status;
      const blocked = permissions.overrides
        .filter((entry) => Array.isArray(entry.permissions) && entry.permissions.length > 0)
        .map((entry) => entry.id);
      const plan = planReconciliation({ globalCommands, guildCommands, guildId, blockedCommandIds: blocked });
      bot.guilds[guildId] = { status: "ok", count: guildCommands.length };
      bot.redundant.push(...plan.redundant);
      bot.mismatched.push(...plan.mismatched);
      bot.guildOnly.push(...plan.guildOnly);
      bot.permissionBlocked.push(...plan.permissionBlocked);
    }
    report.bots[botKey] = bot;
    if (apply) {
      for (const candidate of bot.redundant) {
        await discordRequest(token, `/applications/${appId}/guilds/${candidate.guildId}/commands/${candidate.guildIdValue}`, { method: "DELETE" });
        report.changes.push({ botKey, action: "delete-guild-command", guildId: candidate.guildId, commandId: candidate.guildIdValue, name: candidate.name, type: candidate.type, keptGlobalId: candidate.globalId });
      }
    }
  }
  await snapshot(directory, "plan.json", report);
  console.log(JSON.stringify(report, null, 2));
  console.error(`Snapshot directory: ${directory}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
