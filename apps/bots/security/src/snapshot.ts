import type { Guild } from "discord.js";
import type { Pool } from "pg";

export interface GuildSnapshot {
  version: 2;
  guildId: string;
  roles: Array<{ id: string; managed: boolean; position: number; name: string; permissions: string; color: number; hoist: boolean; mentionable: boolean }>;
  channels: Array<{ id: string; type: number; position: number; name: string; parentId: string | null; overwrites: Array<{ id: string; type: number; allow: string; deny: string }>; options: Record<string, unknown> }>;
  settings: Record<string, unknown>;
}
const supportedTypes = new Set([0, 2, 4, 5, 13]);
export async function captureGuild(guild: Guild): Promise<GuildSnapshot> {
  const [channels, roles] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  return {
    version: 2, guildId: guild.id,
    roles: [...roles.values()].map(role => ({ id: role.id, managed: role.managed, position: role.rawPosition,
      name: role.name, permissions: role.permissions.bitfield.toString(), color: role.color, hoist: role.hoist, mentionable: role.mentionable })),
    channels: [...channels.values()].filter(channel => channel !== null).map(channel => {
      const value = channel as any;
      const options: Record<string, unknown> = {};
      for (const key of ["topic", "nsfw", "rateLimitPerUser", "bitrate", "userLimit", "rtcRegion", "videoQualityMode", "defaultAutoArchiveDuration"])
        if (value[key] !== undefined) options[key] = value[key];
      return { id: value.id, type: value.type, position: value.rawPosition, name: value.name, parentId: value.parentId,
        overwrites: [...value.permissionOverwrites.cache.values()].map((overwrite: any) => ({ id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() })), options };
    }),
    settings: { name: guild.name, verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications, afkTimeout: guild.afkTimeout, afkChannelId: guild.afkChannelId,
      systemChannelId: guild.systemChannelId, rulesChannelId: guild.rulesChannelId, publicUpdatesChannelId: guild.publicUpdatesChannelId },
  };
}
export function validateRestorableSnapshot(payload: unknown, guildId: string): asserts payload is GuildSnapshot {
  const snapshot = payload as GuildSnapshot;
  if (snapshot?.version !== 2 || snapshot.guildId !== guildId || !Array.isArray(snapshot.roles) || !Array.isArray(snapshot.channels))
    throw new Error("Unsupported legacy or cross-guild snapshot; create a version 2 snapshot first.");
  const unsupported = snapshot.channels.filter(channel => !supportedTypes.has(channel.type));
  if (unsupported.length) throw new Error(`Unsupported snapshot channel types: ${unsupported.map(channel => `${channel.id}:${channel.type}`).join(", ")}. Forum/media/thread restoration needs a separate executor.`);
  const roleIds = new Set(snapshot.roles.map(role => role.id));
  const categoryIds = new Set(snapshot.channels.filter(channel => channel.type === 4).map(channel => channel.id));
  const channelIds = new Set(snapshot.channels.map(channel => channel.id));
  for (const key of ["afkChannelId", "systemChannelId", "rulesChannelId", "publicUpdatesChannelId"])
    if (snapshot.settings[key] && !channelIds.has(String(snapshot.settings[key]))) throw new Error(`Setting ${key} references a channel absent from snapshot`);
  for (const role of snapshot.roles) BigInt(role.permissions);
  for (const channel of snapshot.channels) {
    if (channel.parentId && !categoryIds.has(channel.parentId)) throw new Error(`Missing parent category for ${channel.id}`);
    for (const overwrite of channel.overwrites) {
      BigInt(overwrite.allow); BigInt(overwrite.deny);
      if (overwrite.type === 0 && !roleIds.has(overwrite.id)) throw new Error(`Missing overwrite role ${overwrite.id}`);
    }
  }
}
export interface RestoreAdapter {
  roleExists(id: string): boolean;
  channelExists(id: string): boolean;
  putRole(role: GuildSnapshot["roles"][number], currentId?: string): Promise<string>;
  putChannel(channel: GuildSnapshot["channels"][number], parentId: string | null, overwrites: Array<{ id: string; type: number; allow: string; deny: string }>, currentId?: string): Promise<string>;
  setPositions(roles: Array<{ id: string; position: number }>, channels: Array<{ id: string; position: number }>): Promise<void>;
  setSettings(settings: Record<string, unknown>): Promise<void>;
  checkpoint(step: string, ids: Record<string, string>, work: () => Promise<void>): Promise<void>;
}
/** Ordered executor; checkpoint writes intent before every external step and records remapped IDs afterward. */
export async function executeRestore(snapshot: GuildSnapshot, adapter: RestoreAdapter, ids: Record<string, string>): Promise<void> {
  validateRestorableSnapshot(snapshot, snapshot.guildId);
  for (const role of snapshot.roles) {
    if ((role.managed || role.id === snapshot.guildId) && !adapter.roleExists(role.id))
      throw new Error(`Managed/everyone role ${role.id} cannot be recreated.`);
  }
  for (const role of [...snapshot.roles].sort((a,b) => a.position-b.position)) {
    if (role.id === snapshot.guildId || role.managed) {
      if (!adapter.roleExists(role.id)) throw new Error(`Managed/everyone role ${role.id} cannot be recreated.`);
      ids[role.id] = role.id;
      if (role.managed) continue;
    }
    const existing = ids[role.id] ?? (adapter.roleExists(role.id) ? role.id : undefined);
    await adapter.checkpoint(`role:${role.id}`, ids, async () => { ids[role.id] = await adapter.putRole(role, existing); });
  }
  const ordered = [...snapshot.channels].sort((a,b) => (a.type === 4 ? 0 : 1)-(b.type === 4 ? 0 : 1) || a.position-b.position);
  for (const channel of ordered) {
    const parentId = channel.parentId ? ids[channel.parentId] : null;
    if (channel.parentId && !parentId) throw new Error(`Parent mapping unavailable for ${channel.id}`);
    const overwrites = channel.overwrites.map(item => ({ ...item, id: item.type === 0 ? ids[item.id]! : item.id }));
    if (overwrites.some(item => !item.id)) throw new Error(`Role mapping unavailable for ${channel.id}`);
    const existing = ids[channel.id] ?? (adapter.channelExists(channel.id) ? channel.id : undefined);
    await adapter.checkpoint(`channel:${channel.id}`, ids, async () => { ids[channel.id] = await adapter.putChannel(channel, parentId ?? null, overwrites, existing); });
  }
  await adapter.checkpoint("positions", ids, () => adapter.setPositions(
    snapshot.roles.filter(role => !role.managed && role.id !== snapshot.guildId).map(role => ({ id: ids[role.id]!, position: role.position })),
    snapshot.channels.map(channel => ({ id: ids[channel.id]!, position: channel.position }))));
  const settings = { ...snapshot.settings };
  for (const key of ["afkChannelId", "systemChannelId", "rulesChannelId", "publicUpdatesChannelId"])
    if (settings[key]) { const mapped = ids[String(settings[key])]; if (!mapped) throw new Error(`Setting ${key} has no mapped channel`); settings[key] = mapped; }
  await adapter.checkpoint("settings", ids, () => adapter.setSettings(settings));
}
export async function restoreGuild(pool: Pool, guild: Guild, snapshot: GuildSnapshot, snapshotId: string, actorId: string, interactionKey: string): Promise<void> {
  validateRestorableSnapshot(snapshot, guild.id);
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(hashtext($1))", [`restore:${guild.id}`]);
    const previous = (await db.query("SELECT status,current_step,id_map FROM security.restore_executions WHERE guild_id=$1 AND snapshot_id=$2", [guild.id,snapshotId])).rows[0];
    if (previous?.status === "completed") throw new Error("This snapshot restoration already completed; capture a new snapshot before another recovery.");
    if (previous?.current_step || previous?.status === "unconfirmed") throw new Error(`Previous restore outcome is unconfirmed at ${previous.current_step}; reconcile Discord IDs manually before continuing.`);
    const ids: Record<string,string> = previous?.id_map ?? {};
    await db.query(`INSERT INTO security.restore_executions(guild_id,snapshot_id,requested_by,interaction_key) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id,snapshot_id) DO NOTHING`, [guild.id,snapshotId,actorId,interactionKey]);
    const [channels,roles] = await Promise.all([guild.channels.fetch(),guild.roles.fetch()]);
    await executeRestore(snapshot, {
      roleExists: id => roles.has(id), channelExists: id => channels.has(id),
      putRole: async (role,id) => {
        const options = { name: role.name, permissions: BigInt(role.permissions), color: role.color, hoist: role.hoist, mentionable: role.mentionable, reason: "Snapshot recovery" };
        return (id ? await guild.roles.edit(id,id === guild.id ? { permissions: options.permissions, reason: options.reason } : options) : await guild.roles.create(options)).id;
      },
      putChannel: async (channel,parentId,overwrites,id) => {
        const options: any = { ...channel.options, name: channel.name, type: channel.type, parent: parentId,
          permissionOverwrites: overwrites.map(item => ({ ...item, allow: BigInt(item.allow), deny: BigInt(item.deny) })), reason: "Snapshot recovery" };
        return (id ? await guild.channels.edit(id,options) : await guild.channels.create(options)).id;
      },
      setPositions: async (rolePositions,channelPositions) => { await guild.roles.setPositions(rolePositions.map(item => ({ role: item.id, position: item.position }))); await guild.channels.setPositions(channelPositions.map(item => ({ channel: item.id, position: item.position }))); },
      setSettings: async settings => {
        const options = { ...settings };
        for (const key of ["afkChannel", "systemChannel", "rulesChannel", "publicUpdatesChannel"]) {
          options[key] = options[`${key}Id`]; delete options[`${key}Id`];
        }
        await guild.edit(options as any);
      },
      checkpoint: async (step,map,work) => {
        await db.query("UPDATE security.restore_executions SET current_step=$3,status='running',updated_at=now() WHERE guild_id=$1 AND snapshot_id=$2", [guild.id,snapshotId,step]);
        await work();
        await db.query("UPDATE security.restore_executions SET id_map=$3,current_step=NULL,updated_at=now() WHERE guild_id=$1 AND snapshot_id=$2", [guild.id,snapshotId,JSON.stringify(map)]);
      },
    }, ids);
    await db.query("UPDATE security.restore_executions SET status='completed',updated_at=now() WHERE guild_id=$1 AND snapshot_id=$2", [guild.id,snapshotId]);
  } catch (error) {
    await db.query("UPDATE security.restore_executions SET status='unconfirmed',updated_at=now() WHERE guild_id=$1 AND snapshot_id=$2 AND status <> 'completed'", [guild.id,snapshotId]).catch(() => {});
    throw error;
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtext($1))", [`restore:${guild.id}`]).catch(() => {}); db.release();
  }
}
