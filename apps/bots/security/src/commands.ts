import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Pool } from "pg";
import {
  snapshotChecksum,
  verifySnapshot,
  planRestore,
  trustBand,
  SET_LOCKDOWN_SQL,
  CLEAR_LOCKDOWN_SQL,
  WHITELIST_ADD_SQL,
  SAVE_SNAPSHOT_SQL,
  RECORD_INCIDENT_SQL,
  type RestoreStep,
} from "@ei-point/module-security";

export interface SecurityCommandRequest {
  name: string;
  subcommandGroup?: string | undefined;
  subcommand?: string | undefined;
  options: Record<string, string | number | boolean>;
  guildId: string;
  userId: string;
  key: string;
  isOwner: boolean;
  canManage: boolean;
  defer(): Promise<void>;
  reply(text: string): Promise<void>;
  getGuildChannels(): Promise<Array<{ id: string; name: string }>>;
  getGuildRoles(): Promise<Array<{ id: string; name: string }>>;
}

export const securityCommandDefinitions = [
  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Guild security, antinuke, lockdown, and restore commands")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("View current guild security posture and lockdown state"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("lockdown")
        .setDescription("Engage or clear emergency server lockdown")
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("Lockdown action")
            .setRequired(true)
            .addChoices({ name: "Engage (on)", value: "on" }, { name: "Clear (off)", value: "off" }),
        )
        .addStringOption((opt) => opt.setName("reason").setDescription("Reason for lockdown")),
    )
    .addSubcommand((sub) =>
      sub
        .setName("trust")
        .setDescription("Check trust score and assigned risk band for a member")
        .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true)),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("whitelist")
        .setDescription("Manage trusted users exempt from antinuke triggers")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("Add user to whitelist")
            .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true))
            .addStringOption((opt) => opt.setName("reason").setDescription("Reason for whitelisting").setRequired(true)),
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("Remove user from whitelist")
            .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName("list").setDescription("List whitelisted users")),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("snapshot")
        .setDescription("Manage guild state snapshots for restore drills")
        .addSubcommand((sub) => sub.setName("create").setDescription("Create a checksum-verified guild snapshot"))
        .addSubcommand((sub) => sub.setName("list").setDescription("List recent snapshots"))
        .addSubcommand((sub) =>
          sub
            .setName("plan")
            .setDescription("Generate a restore plan from a snapshot without modifying guild")
            .addStringOption((opt) => opt.setName("snapshot_id").setDescription("Snapshot UUID").setRequired(true)),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("incidents")
        .setDescription("View recent security incidents and threats")
        .addIntegerOption((opt) =>
          opt.setName("limit").setDescription("Max incidents to return (1-25)").setMinValue(1).setMaxValue(25),
        ),
    ),
];

export async function respondToSecurityCommand(
  req: SecurityCommandRequest,
  pool: Pool,
): Promise<void> {
  const { subcommandGroup, subcommand, options, guildId, userId, canManage, isOwner } = req;
  const isPrivileged = canManage || isOwner;

  if (subcommand === "status") {
    const [lockdownRes, incidentRes, whitelistRes] = await Promise.all([
      pool.query<{ active: boolean; reason: string | null; updated_at: Date }>(
        "SELECT active, reason, updated_at FROM security.lockdown_state WHERE guild_id = $1",
        [guildId],
      ),
      pool.query<{ count: string }>(
        "SELECT count(*)::text as count FROM security.incidents WHERE guild_id = $1 AND created_at > now() - interval '24 hours'",
        [guildId],
      ),
      pool.query<{ count: string }>(
        "SELECT count(*)::text as count FROM security.whitelist WHERE guild_id = $1",
        [guildId],
      ),
    ]);

    const lockdown = lockdownRes.rows[0];
    const statusText = lockdown?.active
      ? `🔴 **LOCKDOWN ACTIVE** (Reason: ${lockdown.reason ?? "None specified"})`
      : "🟢 Normal Operations";

    await req.reply(
      `**Security Status for Guild \`${guildId}\`**\n` +
        `• Status: ${statusText}\n` +
        `• Recent Incidents (24h): ${incidentRes.rows[0]?.count ?? "0"}\n` +
        `• Whitelisted Members: ${whitelistRes.rows[0]?.count ?? "0"}\n` +
        `• Antinuke Protection: Active`,
    );
    return;
  }

  if (subcommand === "lockdown") {
    if (!isPrivileged) {
      await req.reply("❌ Permission denied: Manage Server or Administrator permission required.");
      return;
    }
    const mode = String(options.mode ?? "on");
    const reason = options.reason ? String(options.reason) : null;

    if (mode === "on") {
      await pool.query(SET_LOCKDOWN_SQL, [guildId, reason ?? "Manual lockdown triggered", userId]);
      await pool.query(RECORD_INCIDENT_SQL, [
        guildId,
        "lockdown_engaged",
        userId,
        "high",
        JSON.stringify({ reason }),
        `lockdown-on-${guildId}-${Date.now()}`,
      ]);
      await req.reply(`🚨 **Lockdown ENGAGED** by <@${userId}>. Reason: ${reason ?? "Not provided"}`);
    } else {
      await pool.query(CLEAR_LOCKDOWN_SQL, [guildId]);
      await pool.query(RECORD_INCIDENT_SQL, [
        guildId,
        "lockdown_cleared",
        userId,
        "medium",
        JSON.stringify({ reason }),
        `lockdown-off-${guildId}-${Date.now()}`,
      ]);
      await req.reply(`✅ **Lockdown CLEARED** by <@${userId}>.`);
    }
    return;
  }

  if (subcommand === "trust") {
    const targetUserId = String(options.user ?? userId);
    const [trustRes, whitelistRes] = await Promise.all([
      pool.query<{ score: number }>(
        "SELECT score FROM security.trust_state WHERE guild_id = $1 AND user_id = $2",
        [guildId, targetUserId],
      ),
      pool.query(
        "SELECT 1 FROM security.whitelist WHERE guild_id = $1 AND user_id = $2",
        [guildId, targetUserId],
      ),
    ]);

    const isWhitelisted = (whitelistRes.rowCount ?? 0) > 0;
    const score = isWhitelisted ? 100 : (trustRes.rows[0]?.score ?? 100);
    const band = trustBand(score);

    await req.reply(
      `**Trust Report for <@${targetUserId}>**\n` +
        `• Trust Score: **${score} / 100**\n` +
        `• Security Band: **${band.toUpperCase()}**\n` +
        `• Whitelisted: ${isWhitelisted ? "Yes (Immune to antinuke)" : "No"}`,
    );
    return;
  }

  if (subcommandGroup === "whitelist") {
    if (!isPrivileged) {
      await req.reply("❌ Permission denied: Manage Server required to configure whitelist.");
      return;
    }

    if (subcommand === "add") {
      const targetUser = String(options.user);
      const reason = String(options.reason ?? "Whitelisted by staff");
      await pool.query(WHITELIST_ADD_SQL, [guildId, targetUser, reason, userId]);
      await req.reply(`✅ Added <@${targetUser}> to the security whitelist. (Reason: ${reason})`);
      return;
    }

    if (subcommand === "remove") {
      const targetUser = String(options.user);
      await pool.query(
        "DELETE FROM security.whitelist WHERE guild_id = $1 AND user_id = $2",
        [guildId, targetUser],
      );
      await req.reply(`✅ Removed <@${targetUser}> from the security whitelist.`);
      return;
    }

    if (subcommand === "list") {
      const res = await pool.query<{ user_id: string; reason: string; created_at: Date }>(
        "SELECT user_id, reason, created_at FROM security.whitelist WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 20",
        [guildId],
      );
      if (res.rows.length === 0) {
        await req.reply("No members currently whitelisted.");
        return;
      }
      const lines = res.rows.map(
        (r) => `• <@${r.user_id}>: ${r.reason} (${new Date(r.created_at).toLocaleDateString()})`,
      );
      await req.reply(`**Security Whitelist (Top 20):**\n${lines.join("\n")}`);
      return;
    }
  }

  if (subcommandGroup === "snapshot") {
    if (!isPrivileged) {
      await req.reply("❌ Permission denied: Manage Server required for snapshots.");
      return;
    }

    if (subcommand === "create") {
      const channels = await req.getGuildChannels();
      const roles = await req.getGuildRoles();
      const payload: Record<string, { name: string; kind: RestoreStep["kind"] }> = {};

      for (const ch of channels) {
        payload[ch.id] = { name: ch.name, kind: "channel" };
      }
      for (const ro of roles) {
        payload[ro.id] = { name: ro.name, kind: "role" };
      }

      const checksum = snapshotChecksum(payload);
      const res = await pool.query<{ snapshot_id: string }>(
        SAVE_SNAPSHOT_SQL + " RETURNING snapshot_id",
        [guildId, JSON.stringify(payload), checksum, userId],
      );
      const id = res.rows[0]?.snapshot_id;
      await req.reply(
        `📸 Snapshot created successfully!\n` +
          `• Snapshot ID: \`${id}\`\n` +
          `• Entities: ${channels.length} channels, ${roles.length} roles\n` +
          `• Checksum (SHA-256): \`${checksum.slice(0, 16)}...\``,
      );
      return;
    }

    if (subcommand === "list") {
      const res = await pool.query<{
        snapshot_id: string;
        checksum: string;
        created_at: Date;
        created_by: string;
      }>(
        "SELECT snapshot_id, checksum, created_at, created_by FROM security.snapshots WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 5",
        [guildId],
      );
      if (res.rows.length === 0) {
        await req.reply("No snapshots found for this guild.");
        return;
      }
      const lines = res.rows.map(
        (s) =>
          `• \`${s.snapshot_id}\` — SHA256: \`${s.checksum.slice(0, 12)}...\` by <@${s.created_by}> at ${new Date(s.created_at).toISOString()}`,
      );
      await req.reply(`**Guild Snapshots:**\n${lines.join("\n")}`);
      return;
    }

    if (subcommand === "plan") {
      const snapshotId = String(options.snapshot_id);
      const res = await pool.query<{ payload: any; checksum: string }>(
        "SELECT payload, checksum FROM security.snapshots WHERE snapshot_id = $1 AND guild_id = $2",
        [snapshotId, guildId],
      );
      if (res.rows.length === 0) {
        await req.reply("❌ Snapshot not found.");
        return;
      }

      const { payload, checksum } = res.rows[0]!;
      if (!verifySnapshot(payload, checksum)) {
        await req.reply("❌ Snapshot checksum mismatch! Tampered or corrupted snapshot.");
        return;
      }

      const currentChannels = await req.getGuildChannels();
      const currentRoles = await req.getGuildRoles();
      const currentIds = new Set([
        ...currentChannels.map((c) => c.id),
        ...currentRoles.map((r) => r.id),
      ]);

      const steps = planRestore(payload, currentIds);
      if (steps.length === 0) {
        await req.reply("✅ Guild matches snapshot perfectly. No restoration steps needed.");
        return;
      }

      const preview = steps
        .slice(0, 10)
        .map((st) => `• [${st.action.toUpperCase()}] ${st.kind}: ${st.detail}`)
        .join("\n");
      const more = steps.length > 10 ? `\n...and ${steps.length - 10} more items.` : "";

      await req.reply(
        `**Restore Plan (${steps.length} changes detected):**\n${preview}${more}\n\n*Note: Run through disaster recovery procedures to execute.*`,
      );
      return;
    }
  }

  if (subcommand === "incidents") {
    if (!isPrivileged) {
      await req.reply("❌ Permission denied: Manage Server required to view incidents.");
      return;
    }
    const limit = Number(options.limit ?? 10);
    const res = await pool.query<{
      kind: string;
      actor_id: string | null;
      severity: string;
      detail: any;
      created_at: Date;
    }>(
      "SELECT kind, actor_id, severity, detail, created_at FROM security.incidents WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2",
      [guildId, limit],
    );

    if (res.rows.length === 0) {
      await req.reply("No security incidents recorded.");
      return;
    }

    const lines = res.rows.map((inc) => {
      const actor = inc.actor_id ? `<@${inc.actor_id}>` : "System";
      return `• [${inc.severity.toUpperCase()}] **${inc.kind}** by ${actor} at ${new Date(inc.created_at).toLocaleString()}`;
    });
    await req.reply(`**Security Incident History (Last ${res.rows.length}):**\n${lines.join("\n")}`);
    return;
  }

  await req.reply("Unknown security command.");
}
