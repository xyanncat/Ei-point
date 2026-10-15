import {
  ChannelType,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Role,
} from "discord.js";
import type { Pool } from "pg";
import {
  canModerate,
  validateTimeout,
  planPurge,
  CREATE_CASE_SQL,
  LIST_CASES_SQL,
  SUPERSEDE_OLDER_SQL,
  SANCTION_LOCK_SQL,
  SANCTION_UNLOCK_SQL,
  sanctionLockKey,
  type CaseKind,
} from "@ei-point/module-moderation";

export interface ModerationCommandRequest {
  name: string;
  subcommand?: string | undefined;
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
  targetRole?: Role | null;
  getRestrictionState?(channelId: string, userId: string): Promise<{ sendMessages: boolean | null; sendMessagesInThreads: boolean | null }>;
  setRestrictionState?(channelId: string, userId: string, state: { sendMessages: boolean | null; sendMessagesInThreads: boolean | null }, reason: string): Promise<void>;
  channelId?: string | undefined;
  addMemberRole?(member: GuildMember, role: Role, reason: string): Promise<void>;
  removeMemberRole?(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  kickMember?(member: GuildMember, reason: string): Promise<void>;
  banUser(userId: string, deleteSeconds: number, reason: string): Promise<void>;
  unbanUser(userId: string, reason: string): Promise<void>;
  timeoutMember(member: GuildMember, durationMs: number, reason: string): Promise<void>;
  clearTimeout(member: GuildMember, reason: string): Promise<void>;
  bulkDeleteMessages(count: number): Promise<number>;
}

export const moderationCommandDefinitions = [
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Remove a member from this guild")
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
    .addStringOption((opt) => opt.setName("reason").setDescription("Reason for kick").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue or remove a formal warning")
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("add").setDescription("Issue a formal warning to a member")
      .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason for warning").setRequired(true)))
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove a warning by case ID")
      .addIntegerOption((opt) => opt.setName("case_id").setDescription("Warning case ID").setRequired(true).setMinValue(1))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason for removing the warning").setRequired(true))),

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
    .setDescription("Apply or remove a member timeout")
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("apply").setDescription("Temporarily restrict a member")
      .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
      .addIntegerOption((opt) => opt.setName("minutes").setDescription("Timeout duration in minutes (1 - 40,320)").setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason for timeout").setRequired(true)))
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove an active member timeout")
      .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason for removing the timeout").setRequired(true))),

  new SlashCommandBuilder()
    .setName("temp")
    .setDescription("Apply a temporary member restriction")
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("ban").setDescription("Temporarily ban a user")
      .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption((opt) => opt.setName("minutes").setDescription("Ban duration in minutes (1 - 40,320)").setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason for temporary ban").setRequired(true)))
    .addSubcommand((sub) => sub.setName("mute").setDescription("Temporarily mute a member")
      .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
      .addIntegerOption((opt) => opt.setName("minutes").setDescription("Mute duration in minutes (1 - 40,320)").setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason for temporary mute").setRequired(true)))
    .addSubcommand((sub) => sub.setName("role").setDescription("Grant a role temporarily")
      .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
      .addRoleOption((opt) => opt.setName("role").setDescription("Role to grant temporarily").setRequired(true))
      .addIntegerOption((opt) => opt.setName("minutes").setDescription("Role duration in minutes (1 - 40,320)").setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason for temporary role").setRequired(true)))
    .addSubcommand((sub) => sub.setName("restriction").setDescription("Temporarily restrict sending messages in a channel")
      .addUserOption((opt) => opt.setName("user").setDescription("Target member").setRequired(true))
      .addChannelOption((opt) => opt.setName("channel").setDescription("Text channel to restrict").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addIntegerOption((opt) => opt.setName("minutes").setDescription("Restriction duration in minutes (1 - 40,320)").setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason for temporary restriction").setRequired(true))),

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


/** Commit the case intent before Discord. Never replay an ambiguous external action automatically.
 *  When the sanction is applied, equal-kind older cases are superseded so their expiry cannot undo it (A06). */
export async function executeSanction(
  pool: Pool, req: ModerationCommandRequest, targetId: string, kind: CaseKind,
  reason: string, effect: () => Promise<unknown>, expiresAt: string | null = null,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const key = `moderation:${req.guildId}:${req.key}:${kind}`;
  const result = await pool.query<{ case_id: string }>(
    `INSERT INTO moderation.cases(guild_id,user_id,kind,reason,expires_at,moderator_id,idempotency_key,execution_status,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8) ON CONFLICT(idempotency_key) DO NOTHING RETURNING case_id`,
    [req.guildId, targetId, kind, reason, expiresAt, req.userId, key, metadata]);
  const caseId = result.rows[0]?.case_id;
  if (!caseId) throw new Error("This interaction already has a durable case; inspect its execution status before retrying.");
  try {
    await effect();
  } catch (error) {
    await pool.query("UPDATE moderation.cases SET execution_status='unconfirmed' WHERE case_id=$1", [caseId]).catch(() => {});
    throw new Error(`Case #${caseId}: external outcome unconfirmed; inspect Discord before retrying.`, { cause: error });
  }
  // Effect confirmed. Record and supersede under the sanction lock so expiry cleanup
  // cannot interleave; supersede failure is retryable bookkeeping and must never flip
  // a confirmed sanction to unconfirmed (A06).
  const expiryKind = kind === "ban" || kind === "timeout" || kind === "temp_role" || kind === "temp_restriction";
  const lockKey = sanctionLockKey(req.guildId, targetId, kind);
  if (expiryKind) await pool.query(SANCTION_LOCK_SQL, [lockKey]).catch(() => {});
  try {
    try {
      await pool.query("UPDATE moderation.cases SET execution_status='applied' WHERE case_id=$1", [caseId]);
    } catch (error) {
      await pool.query("UPDATE moderation.cases SET execution_status='unconfirmed' WHERE case_id=$1", [caseId]).catch(() => {});
      throw new Error(`Case #${caseId}: external outcome unconfirmed; inspect Discord before retrying.`, { cause: error });
    }
    if (expiryKind) {
      const supersedeKey = kind === "temp_role" ? "roleId" : kind === "temp_restriction" ? "channelId" : null;
      const supersedeValue = supersedeKey && typeof metadata[supersedeKey] === "string" ? metadata[supersedeKey] : null;
      await pool.query(SUPERSEDE_OLDER_SQL, [req.guildId, targetId, kind, caseId, supersedeKey, supersedeValue])
        .catch(() => console.warn(`moderation case ${caseId}: supersede bookkeeping failed; expiry will re-check ownership`));
    }
  } finally {
    if (expiryKind) await pool.query(SANCTION_UNLOCK_SQL, [lockKey]).catch(() => {});
  }
  return caseId;
}

async function removeWarningCase(
  pool: Pool,
  req: ModerationCommandRequest,
  caseId: number,
  reason: string,
): Promise<{ userId: string; removalCaseId: string } | null> {
  const client = await pool.connect();
  const idempotencyKey = `moderation:${req.guildId}:${req.key}:warn_remove`;
  try {
    await client.query("BEGIN");
    const previous = await client.query<{ user_id: string; case_id: string }>(
      "SELECT user_id, case_id FROM moderation.cases WHERE idempotency_key=$1 FOR UPDATE",
      [idempotencyKey],
    );
    if (previous.rows[0]) {
      await client.query("COMMIT");
      return { userId: previous.rows[0].user_id, removalCaseId: previous.rows[0].case_id };
    }
    const warning = await client.query<{ user_id: string }>(
      "SELECT user_id FROM moderation.cases WHERE case_id=$1 AND guild_id=$2 AND kind='warn' AND execution_status='applied' FOR UPDATE",
      [caseId, req.guildId],
    );
    const target = warning.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "UPDATE moderation.cases SET execution_status='voided' WHERE case_id=$1 AND guild_id=$2",
      [caseId, req.guildId],
    );
    const removal = await client.query<{ case_id: string }>(
      `INSERT INTO moderation.cases(guild_id,user_id,kind,reason,moderator_id,idempotency_key,execution_status)
       VALUES($1,$2,'warn_remove',$3,$4,$5,'applied') RETURNING case_id`,
      [req.guildId, target.user_id, `Removed warning case #${caseId}: ${reason}`, req.userId, idempotencyKey],
    );
    await client.query("COMMIT");
    return { userId: target.user_id, removalCaseId: removal.rows[0]!.case_id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function respondToModerationCommand(
  req: ModerationCommandRequest,
  pool: Pool,
): Promise<void> {
  const { name, subcommand, options, guildId, userId, isOwner, canManage, userScopes } = req;
  const isPrivileged = isOwner || canManage;

  const checkPerm = (kind: CaseKind): boolean => {
    return isPrivileged || canModerate(userScopes, kind);
  };

  if (name === "kick") {
    if (!checkPerm("kick")) {
      await req.reply("Permission denied: the guild owner or an Administrator is required.");
      return;
    }
    const targetUserId = String(options.user);
    const reason = String(options.reason);
    if (!req.targetMember?.kickable || !req.kickMember) {
      await req.reply("The target member could not be found or is not manageable by Kafka.");
      return;
    }
    const caseId = await executeSanction(pool, req, targetUserId, "kick", reason, () => req.kickMember!(req.targetMember!, reason));
    await req.reply(`👢 Kicked <@${targetUserId}> (Case #${caseId}). Reason: ${reason}`);
    return;
  }

  if (name === "temp") {
    const kind = subcommand === "ban" ? "ban" : subcommand === "mute" ? "timeout" : subcommand === "role" ? "temp_role" : subcommand === "restriction" ? "temp_restriction" : null;
    if (!kind || !checkPerm(kind)) {
      await req.reply("Permission denied or unsupported temporary action.");
      return;
    }
    const targetUserId = String(options.user);
    const reason = String(options.reason);
    const minutes = Number(options.minutes);
    const durationMs = minutes * 60_000;
    if (!validateTimeout(durationMs)) {
      await req.reply("Temporary actions must be between 1 minute and 28 days.");
      return;
    }
    const expiresAt = new Date(Date.now() + durationMs).toISOString();

    if (subcommand === "ban") {
      const caseId = await executeSanction(pool, req, targetUserId, "ban", reason, () => req.banUser(targetUserId, 0, reason), expiresAt, { temporary: true });
      await req.reply(`Temporary ban applied to <@${targetUserId}> for ${minutes}m (Case #${caseId}).`);
      return;
    }
    if (!req.targetMember) {
      await req.reply("Target member is not currently in the server.");
      return;
    }
    if (subcommand === "mute") {
      if (!req.targetMember.moderatable) {
        await req.reply("Kafka cannot time out that member because of Discord role hierarchy or permissions.");
        return;
      }
      const caseId = await executeSanction(pool, req, targetUserId, "timeout", reason, () => req.timeoutMember(req.targetMember!, durationMs, reason), expiresAt, { temporary: true, mode: "mute" });
      await req.reply(`Temporary mute applied to <@${targetUserId}> for ${minutes}m (Case #${caseId}).`);
      return;
    }
    if (subcommand === "role") {
      const role = req.targetRole;
      if (!role || !req.addMemberRole || !req.targetMember.manageable || role.managed || role.permissions.has(PermissionFlagsBits.Administrator) || !role.editable || req.targetMember.roles.cache.has(role.id)) {
        await req.reply("Choose a manageable, non-administrator role that the member does not already have.");
        return;
      }
      const caseId = await executeSanction(pool, req, targetUserId, "temp_role", reason, () => req.addMemberRole!(req.targetMember!, role, reason), expiresAt, { roleId: role.id });
      await req.reply(`Role <@&${role.id}> granted to <@${targetUserId}> for ${minutes}m (Case #${caseId}).`);
      return;
    }
    const channelId = req.channelId;
    if (!channelId || !req.getRestrictionState || !req.setRestrictionState) {
      await req.reply("The selected text channel cannot be temporarily restricted by Kafka.");
      return;
    }
    let prior: { sendMessages: boolean | null; sendMessagesInThreads: boolean | null };
    try {
      prior = await req.getRestrictionState(channelId, targetUserId);
    } catch {
      await req.reply("The selected text channel cannot be temporarily restricted by Kafka.");
      return;
    }
    if (prior.sendMessages === false && prior.sendMessagesInThreads === false) {
      await req.reply("That member is already restricted from sending messages in the selected channel.");
      return;
    }
    const caseId = await executeSanction(
      pool, req, targetUserId, "temp_restriction", reason,
      () => req.setRestrictionState!(channelId, targetUserId, { sendMessages: false, sendMessagesInThreads: false }, reason),
      expiresAt,
      { channelId, previousSendMessages: prior.sendMessages, previousSendMessagesInThreads: prior.sendMessagesInThreads },
    );
    await req.reply(`Temporary restriction applied to <@${targetUserId}> in <#${channelId}> for ${minutes}m (Case #${caseId}).`);
    return;
  }

  if (name === "warn") {
    if (!checkPerm("warn")) {
      await req.reply("❌ Permission denied: `moderation-warn` scope or Manage Server required.");
      return;
    }
    const reason = String(options.reason);
    if (subcommand === "remove") {
      const result = await removeWarningCase(pool, req, Number(options.case_id), reason);
      if (!result) {
        await req.reply("Warning case not found, already removed, or outside this server.");
        return;
      }
      await req.reply(`✅ Warning case #${options.case_id} was removed (audit case #${result.removalCaseId}). Reason: ${reason}`);
      return;
    }
    if (subcommand !== "add") {
      await req.reply("Choose `/warn add` or `/warn remove`.");
      return;
    }
    const targetUserId = String(options.user);
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
    const reason = String(options.reason);
    if (!req.targetMember) {
      await req.reply("❌ Target member is not currently in the server.");
      return;
    }
    if (!req.targetMember.moderatable) {
      await req.reply("Kafka cannot change that member's timeout because of Discord role hierarchy or permissions.");
      return;
    }

    if (subcommand === "remove") {
      const caseId = await executeSanction(pool, req, targetUserId, "timeout_remove", `Remove timeout: ${reason}`, () => req.clearTimeout(req.targetMember!, reason));
      await req.reply(`✅ Removed <@${targetUserId}>'s timeout (Case #${caseId}). Reason: ${reason}`);
      return;
    }
    if (subcommand !== "apply") {
      await req.reply("Choose `/timeout apply` or `/timeout remove`.");
      return;
    }
    const minutes = Number(options.minutes);
    const durationMs = minutes * 60 * 1000;
    if (!validateTimeout(durationMs)) {
      await req.reply("❌ Invalid timeout duration. Maximum allowed timeout is 28 days.");
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
