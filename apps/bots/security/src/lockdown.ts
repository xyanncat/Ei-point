import { GuildVerificationLevel, type Guild } from "discord.js";
import type { Pool } from "pg";

type Original = { verificationLevel: number; channels: Record<string, Array<{ id: string; type: number; allow: string; deny: string }>> };
/** Keep a durable recovery image before the first Discord mutation. Partial failure stays recoverable. */
export async function applyLockdown(pool: Pool, guild: Guild, active: boolean, actorId: string, reason: string): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(hashtext($1))", [`lockdown:${guild.id}`]);
    const state = (await db.query("SELECT original_permissions FROM security.lockdown_state WHERE guild_id=$1", [guild.id])).rows[0];
    let original: Original | undefined = state?.original_permissions ?? undefined;
    const channels = await guild.channels.fetch();
    if (active) {
      original ??= { verificationLevel: guild.verificationLevel, channels: {} };
      for (const channel of channels.values()) {
        if (!channel || !("permissionOverwrites" in channel)) continue;
        if (!(channel.id in original.channels)) {
          original.channels[channel.id] = [...channel.permissionOverwrites.cache.values()].map(overwrite => ({
            id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString(),
          }));
        }
      }
      await db.query(`INSERT INTO security.lockdown_state(guild_id,active,reason,updated_by,original_permissions,effects_status)
        VALUES($1,true,$2,$3,$4,'pending') ON CONFLICT(guild_id) DO UPDATE SET active=true,reason=$2,updated_by=$3,original_permissions=$4,effects_status='pending',updated_at=now()`,
        [guild.id, reason, actorId, JSON.stringify(original)]);
      for (const channel of channels.values()) {
        if (!channel || !("permissionOverwrites" in channel)) continue;
        // Explicit role/member allows override @everyone denies; restrict those overwrites too.
        const targets = new Set([guild.id, ...channel.permissionOverwrites.cache.keys()]);
        for (const id of targets) await channel.permissionOverwrites.edit(id, { SendMessages: false, AddReactions: false, Connect: false,
          CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false }, { reason });
      }
      await guild.setVerificationLevel(Math.max(guild.verificationLevel, GuildVerificationLevel.High), reason);
      await db.query("UPDATE security.lockdown_state SET effects_status='applied',updated_at=now() WHERE guild_id=$1", [guild.id]);
    } else {
      if (!original) throw new Error("No durable original permissions exist; manual recovery is required.");
      await db.query("UPDATE security.lockdown_state SET effects_status='restoring',updated_at=now() WHERE guild_id=$1", [guild.id]);
      for (const [id, overwrite] of Object.entries(original.channels)) {
        const channel = channels.get(id);
        if (!channel || !("permissionOverwrites" in channel)) continue;
        await channel.permissionOverwrites.set(overwrite.map(item => ({
          id: item.id, type: item.type as 0 | 1, allow: BigInt(item.allow), deny: BigInt(item.deny),
        })), reason);
      }
      await guild.setVerificationLevel(original.verificationLevel, reason);
      await db.query("UPDATE security.lockdown_state SET active=false,effects_status='restored',original_permissions=NULL,updated_at=now() WHERE guild_id=$1", [guild.id]);
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtext($1))", [`lockdown:${guild.id}`]).catch(() => {});
    db.release();
  }
}
