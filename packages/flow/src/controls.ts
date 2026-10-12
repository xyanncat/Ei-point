import type { SqlPool } from "./database.js";
import { transaction, lockApprovedGuild } from "./database.js";
export type ControlQuery = (
  sql: string,
  params?: unknown[],
) => Promise<Record<string, any>[]>;
interface ControlDependencies {
  query: ControlQuery;
  transaction: <T>(work: (query: ControlQuery) => Promise<T>) => Promise<T>;
}

/** Translate only fields actually consumed by CommunityService; reject unsupported placeholders. */
export function communityConfigurationPatch(
  moduleId: string,
  value: Record<string, unknown>,
): Record<string, string | null> | null {
  const allowed: Record<string, string[]> = {
    welcome: [
      "welcome_channel",
      "leave_channel",
      "welcome_message",
      "leave_message",
    ],
    leveling: ["level_channel"],
    community: [
      "welcome_channel",
      "leave_channel",
      "welcome_message",
      "leave_message",
      "level_channel",
    ],
  };
  const keys = allowed[moduleId];
  if (!keys || Object.keys(value).some((k) => !keys.includes(k))) return null;
  const patch: Record<string, string | null> = {};
  for (const k of keys) {
    const raw = value[k];
    if (typeof raw !== "string") return null;
    if (k.endsWith("_channel")) {
      if (raw && !/^\d{17,20}$/.test(raw)) return null;
      patch[
        (
          {
            welcome_channel: "welcomeChannelId",
            leave_channel: "leaveChannelId",
            level_channel: "levelChannelId",
          } as Record<string, string>
        )[k]!
      ] = raw || null;
    } else {
      if (
        raw.length > 500 ||
        /\{(?!user\}|username\}|guild\}|server\}|count\}|membercount\})[^}]+\}/.test(
          raw,
        )
      )
        return null;
      patch[k === "welcome_message" ? "welcomeTemplate" : "leaveTemplate"] = (
        raw ||
        (k === "welcome_message"
          ? "Welcome {user} to {guild}!"
          : "{user} left {guild}.")
      )
        .replaceAll("{server}", "{guild}")
        .replaceAll("{membercount}", "{count}");
    }
  }
  return patch;
}

/** Installation and exact-version acknowledgement share one transaction. Unsupported modules remain saved. */
export async function applyCommunityConfiguration(
  pool: SqlPool,
  guildId: string,
  botKey: string,
): Promise<number> {
  return transaction(pool, async (db) => {
    await lockApprovedGuild(db, guildId);
    const q: ControlQuery = async (sql, params) =>
      (await db.query(sql, params)).rows;
    if (!(await isControlEnabled(q, guildId, botKey))) return 0;
    const registered = (
      await db.query(
        "SELECT modules FROM config.bots WHERE bot_key=$1 AND $2=ANY(guild_ids)",
        [botKey, guildId],
      )
    ).rows[0];
    const rows = (
      await db.query(
        `SELECT * FROM (SELECT DISTINCT ON(key) key,version,value,applied_at,updated_at FROM config.settings WHERE scope=$1 AND key=ANY($2::text[]) ORDER BY key,version DESC) latest WHERE applied_at IS NULL ORDER BY updated_at`,
        [`guild:${guildId}`, registered?.modules ?? []],
      )
    ).rows;
    let applied = 0;
    for (const row of rows) {
      const patch = communityConfigurationPatch(row.key, row.value);
      if (!patch) continue;
      await db.query(
        `INSERT INTO community.welcome_templates(guild_id,template) VALUES($1,$2) ON CONFLICT(guild_id) DO UPDATE SET template=community.welcome_templates.template||EXCLUDED.template,updated_at=now()`,
        [guildId, JSON.stringify(patch)],
      );
      await acknowledgeConfiguration(q, guildId, row.key, row.version);
      applied++;
    }
    return applied;
  });
}

/** Invoke before every guild command/event: state is read from PostgreSQL, never a permissive cache. */
export async function isControlEnabled(
  query: ControlQuery,
  guildId: string,
  botKey: string,
  command?: string,
  roleIds: string[] = [],
): Promise<boolean> {
  const rows = await query(
    `SELECT g.approved, b.bot_key, COALESCE(c.server_paused,false) server_paused,
 COALESCE(s.enabled,true) enabled, COALESCE(s.paused,false) paused,
 p.enabled command_enabled,p.role_ids
 FROM access.guilds g JOIN config.bots b ON b.bot_key=$2 AND g.guild_id=ANY(b.guild_ids)
 LEFT JOIN config.guild_controls c ON c.guild_id=g.guild_id
 LEFT JOIN config.bot_states s ON s.guild_id=g.guild_id AND s.bot_key=b.bot_key
 LEFT JOIN config.command_permissions p ON p.guild_id=g.guild_id AND p.bot_key=b.bot_key AND p.command=$3
 WHERE g.guild_id=$1`,
    [guildId, botKey, command?.replace(/^\//, "") ?? null],
  );
  const row = rows[0];
  if (
    !row ||
    !row.approved ||
    !row.enabled ||
    row.paused ||
    row.server_paused ||
    row.command_enabled === false
  )
    return false;
  return (
    !row.role_ids?.length ||
    row.role_ids.some((role: string) => roleIds.includes(role))
  );
}

/** Only acknowledge after the real runtime has successfully installed this exact version. */
export async function acknowledgeConfiguration(
  query: ControlQuery,
  guildId: string,
  moduleId: string,
  version: number,
) {
  await query(
    "UPDATE config.settings SET applied_at=now() WHERE scope=$1 AND key=$2 AND version=$3 AND applied_at IS NULL",
    [`guild:${guildId}`, moduleId, version],
  );
}

/** Worker entry point; external sending is entirely supplied by its caller. No token => no lease/no send. */
export async function consumeEmbedJob(
  deps: Pick<ControlDependencies, "query" | "transaction"> & {
    token?: string;
    botKey?: string;
    send: (payload: Record<string, any>, token: string) => Promise<void>;
  },
): Promise<"disabled" | "idle" | "done" | "deferred" | "failed"> {
  if (!deps.token || !deps.botKey) return "disabled";
  const job = await deps.transaction(async (q) => {
    const rows = await q(
      `SELECT job_id,payload FROM ops.jobs WHERE kind='dashboard.embed' AND payload->>'bot_id'=$1
 AND status='pending' AND next_run_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      [deps.botKey],
    );
    const j = rows[0];
    if (!j) return null;
    await q(
      "UPDATE ops.jobs SET status='leased',attempts=attempts+1,lease_owner='dashboard-embed',lease_expires_at=now()+interval '60 seconds',updated_at=now() WHERE job_id=$1",
      [j.job_id],
    );
    return j;
  });
  if (!job) return "idle";
  try {
    if (
      !(await isControlEnabled(
        deps.query,
        job.payload.guild_id,
        job.payload.bot_id,
      ))
    ) {
      await deps.query(
        "UPDATE ops.jobs SET status='pending',lease_owner=NULL,lease_expires_at=NULL,next_run_at=now()+interval '60 seconds',updated_at=now() WHERE job_id=$1",
        [job.job_id],
      );
      return "deferred";
    }
    // A Discord timeout is ambiguous: do not automatically retry a possible delivered embed.
    await deps.send(
      {
        ...job.payload,
        delivery_nonce: String(job.job_id).replaceAll("-", "").slice(0, 25),
      },
      deps.token,
    );
    await deps.query(
      "UPDATE ops.jobs SET status='done',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE job_id=$1",
      [job.job_id],
    );
    return "done";
  } catch {
    await deps.query(
      "UPDATE ops.jobs SET status='failed',last_error='delivery-unconfirmed',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE job_id=$1",
      [job.job_id],
    );
    return "failed";
  }
}
