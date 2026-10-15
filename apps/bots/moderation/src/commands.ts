import {
  ChannelType,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Pool } from "pg";
import {
  canModerate,
  validateTimeout,
  planPurge,
  CREATE_CASE_SQL,
  LIST_CASES_SQL,
  type CaseKind,
} from "@ei-point/module-moderation";

export interface ModerationCommandRequest {
  name: string;
  options: Record<string, string | number | boolean>;
  guildId: string;
  userId: string;
  key: string;
  isOwner: boolean;
  canManage: boolean;
  userScopes: string[];
  defer(): Promise<void>;
  reply(text: string): Promise<void>;
  targetMember?: GuildMember | null;
  banUser(userId: string, deleteSeconds: number, reason: string): Promise<void>;
  unbanUser(userId: string, reason: string): Promise<void>;
  timeoutMember(member: GuildMember, durationMs: number, reason: string): Promise<void>;
  bulkDeleteMessages(count: number): Promise<number>;
}

export const moderationCommandDefinitions = [
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue a formal warning to a guild member")
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
    .addStringOption((opt) => opt.setName("reason").setDescription("Reason for warning").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from the guild")
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName("user").setDescription("Target member or user ID").setRequired(true))
    .addStringOption((opt) => opt.setName("reason").setDescription("Reason for ban").setRequired(true))
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("Days of message history to delete (0-7)")
        .setMinValue(0)
        .setMaxValue(7),
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a previously banned user by ID")
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName("user_id").setDescription("User ID to unban").setRequired(true))
    .addStringOption((opt) => opt.setName("reason").setDescription("Reason for unban").setRequired(true)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily restrict a member from speaking or reacting")
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
    .addIntegerOption((opt) =>
      opt
        .setName("minutes")
        .setDescription("Timeout duration in minutes (1 - 40,320)")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true),
    )
    .addStringOption((opt) => opt.setName("reason").setDescription("Reason for timeout").setRequired(true)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk delete recent messages in this channel")
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt
        .setName("count")
        .setDescription("Number of messages to delete (1-100)")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("View moderation history for a user")
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName("limit").setDescription("Max cases to show (1-25)").setMinValue(1).setMaxValue(25),
    ),

  new SlashCommandBuilder()
    .setName("note")
    .setDescription("Add an internal staff note to a user's record")
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true))
    .addStringOption((opt) => opt.setName("text").setDescription("Note content").setRequired(true)),
];

export async function recordModerationCase(
  pool: Pool,
  guildId: string,
  userId: string,
  kind: CaseKind,
  reason: string,
  moderatorId: string,
  expiresAt: string | null = null,
  interactionKey?: string,
): Promise<string> {
  const idempotencyKey = interactionKey ? `moderation:${guildId}:${interactionKey}:${kind}` : `case-${guildId}-${userId}-${kind}-${crypto.randomUUID()}`;
  const res = await pool.query<{ case_id: string }>(CREATE_CASE_SQL, [
    guildId,
    userId,
    kind,
    reason,
    expiresAt,
    moderatorId,
    idempotencyKey,
  ]);
  return res.rows[0]?.case_id ?? "unknown";
}


/** Commit the case intent before Discord. Never replay an ambiguous external action automatically. */
export async function executeSanction(
  pool: Pool, req: ModerationCommandRequest, targetId: string, kind: CaseKind,
  reason: string, effect: () => Promise<unknown>, expiresAt: string | null = null,
): Promise<string> {
  const key = `moderation:${req.guildId}:${req.key}:${kind}`;
  const result = await pool.query<{ case_id: string }>(
    `INSERT INTO moderation.cases(guild_id,user_id,kind,reason,expires_at,moderator_id,idempotency_key,execution_status)
     VALUES($1,$2,$3,$4,$5,$6,$7,'pending') ON CONFLICT(idempotency_key) DO NOTHING RETURNING case_id`,
    [req.guildId, targetId, kind, reason, expiresAt, req.userId, key]);
  const caseId = result.rows[0]?.case_id;
  if (!caseId) throw new Error("This interaction already has a durable case; inspect its execution status before retrying.");
  try {
    await effect();
    await pool.query("UPDATE moderation.cases SET execution_status='applied' WHERE case_id=$1", [caseId]);
  } catch (error) {
    await pool.query("UPDATE moderation.cases SET execution_status='unconfirmed' WHERE case_id=$1", [caseId]).catch(() => {});
    throw new Error(`Case #${caseId}: external outcome unconfirmed; inspect Discord before retrying.`, { cause: error });
  }
  return caseId;
}

export async function respondToModerationCommand(
  req: ModerationCommandRequest,
  pool: Pool,
): Promise<void> {
  const { name, options, guildId, userId, isOwner, canManage, userScopes } = req;
  const isPrivileged = isOwner || canManage;

  const checkPerm = (kind: CaseKind): boolean => {
    return isPrivileged || canModerate(userScopes, kind);
  };

  if (name === "warn") {
    if (!checkPerm("warn")) {
      await req.reply("❌ Permission denied: `moderation-warn` scope or Manage Server required.");
      return;
    }
    const targetUserId = String(options.user);
    const reason = String(options.reason);
    const caseId = await recordModerationCase(pool, guildId, targetUserId, "warn", reason, userId, null, req.key);
    await req.reply(`⚠️ **Warned** <@${targetUserId}> (Case #${caseId}). Reason: ${reason}`);
    return;
  }

  if (name === "ban") {
    if (!checkPerm("ban")) {
      await req.reply("❌ Permission denied: `moderation-ban` scope or Administrator required.");
      return;
    }
    const targetUserId = String(options.user);
    const reason = String(options.reason);
    const days = Number(options.days ?? 0);
    const deleteSeconds = days * 86400;

    const caseId = await executeSanction(pool, req, targetUserId, "ban", reason, () => req.banUser(targetUserId, deleteSeconds, reason));
    await req.reply(`🔨 **Banned** <@${targetUserId}> (Case #${caseId}). Reason: ${reason}`);
    return;
  }

  if (name === "unban") {
    if (!checkPerm("unban")) {
      await req.reply("❌ Permission denied: `moderation-ban` scope required.");
      return;
    }
    const targetUserId = String(options.user_id);
    const reason = String(options.reason);

    const caseId = await executeSanction(pool, req, targetUserId, "unban", reason, () => req.unbanUser(targetUserId, reason));
    await req.reply(`✅ **Unbanned** \`${targetUserId}\` (Case #${caseId}). Reason: ${reason}`);
    return;
  }

  if (name === "timeout") {
    if (!checkPerm("timeout")) {
      await req.reply("❌ Permission denied: `moderation-timeout` scope required.");
      return;
    }
    const targetUserId = String(options.user);
    const minutes = Number(options.minutes);
    const durationMs = minutes * 60 * 1000;
    const reason = String(options.reason);

    if (!validateTimeout(durationMs)) {
      await req.reply("❌ Invalid timeout duration. Maximum allowed timeout is 28 days.");
      return;
    }

    if (!req.targetMember) {
      await req.reply("❌ Target member is not currently in the server.");
      return;
    }

    const expiresAt = new Date(Date.now() + durationMs).toISOString();
    const caseId = await executeSanction(pool, req, targetUserId, "timeout", reason, () => req.timeoutMember(req.targetMember!, durationMs, reason), expiresAt);
    await req.reply(`⏳ **Timed out** <@${targetUserId}> for ${minutes}m (Case #${caseId}). Reason: ${reason}`);
    return;
  }

  if (name === "purge") {
    if (!checkPerm("purge")) {
      await req.reply("❌ Permission denied: `moderation-purge` scope required.");
      return;
    }
    const count = Number(options.count);
    const plan = planPurge(count, 0);

    if (plan.mode === "rejected") {
      await req.reply(`❌ Purge rejected: ${plan.reason}`);
      return;
    }

    let deleted = 0;
    await executeSanction(pool, req, userId, "purge", `Requested purge of ${count} messages`, async () => {
      deleted = await req.bulkDeleteMessages(count);
    });
    await req.reply(`🧹 Deleted **${deleted}** messages.`);
    return;
  }

  if (name === "cases") {
    if (!checkPerm("note")) {
      await req.reply("Permission denied: moderation-note scope or Manage Server required to read internal case history.");
      return;
    }
    const targetUserId = String(options.user);
    const limit = Number(options.limit ?? 10);
    const res = await pool.query<{
      case_id: string;
      kind: string;
      execution_status: string;
      reason: string;
      expires_at: Date | null;
      moderator_id: string;
      created_at: Date;
    }>(LIST_CASES_SQL, [guildId, targetUserId, limit]);

    if (res.rows.length === 0) {
      await req.reply(`No moderation cases found for <@${targetUserId}>.`);
      return;
    }

    const lines = res.rows.map((c) => {
      const exp = c.expires_at ? ` (Expires: ${new Date(c.expires_at).toLocaleDateString()})` : "";
      return `• **Case #${c.case_id}** [${c.kind.toUpperCase()}; ${c.execution_status}] by <@${c.moderator_id}>: ${c.reason}${exp}`;
    });
    await req.reply(`**Moderation Cases for <@${targetUserId}>:**\n${lines.join("\n")}`);
    return;
  }

  if (name === "note") {
    if (!isPrivileged && !userScopes.includes("moderation-note")) {
      await req.reply("❌ Permission denied: Moderator role required.");
      return;
    }
    const targetUserId = String(options.user);
    const text = String(options.text);
    const caseId = await recordModerationCase(pool, guildId, targetUserId, "note", text, userId, null, req.key);
    await req.reply(`📝 Recorded staff note #${caseId} on <@${targetUserId}>.`);
    return;
  }

  await req.reply("Unknown moderation command.");
}
