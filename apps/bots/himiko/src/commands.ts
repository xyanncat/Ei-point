// Himiko command shapes: embed messages & announcements.
// Pure validation + delivery payload building; Discord I/O lives in index.ts.

import { ChannelType, SlashCommandBuilder } from "discord.js";

export const EMBED_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const ANNOUNCE_MAX_TITLE = 256;
export const ANNOUNCE_MAX_DESCRIPTION = 4000;

export interface AnnounceInput {
  channelId: string;
  title: string;
  description: string;
  color?: string;
  pingRoleId?: string;
}

export function validateAnnounceInput(input: {
  channelId: unknown;
  title: unknown;
  description: unknown;
  color?: unknown;
  pingRoleId?: unknown;
}): { ok: true; value: AnnounceInput } | { ok: false; reason: string } {
  if (typeof input.channelId !== "string" || !/^\d{17,20}$/.test(input.channelId))
    return { ok: false, reason: "invalid-channel" };
  if (typeof input.title !== "string" || input.title.trim().length === 0)
    return { ok: false, reason: "title-required" };
  if (input.title.length > ANNOUNCE_MAX_TITLE) return { ok: false, reason: "title-too-long" };
  if (typeof input.description !== "string" || input.description.trim().length === 0)
    return { ok: false, reason: "description-required" };
  if (input.description.length > ANNOUNCE_MAX_DESCRIPTION)
    return { ok: false, reason: "description-too-long" };
  if (input.color !== undefined && (typeof input.color !== "string" || !EMBED_COLOR_RE.test(input.color)))
    return { ok: false, reason: "invalid-color" };
  if (
    input.pingRoleId !== undefined &&
    (typeof input.pingRoleId !== "string" || !/^\d{17,20}$/.test(input.pingRoleId))
  )
    return { ok: false, reason: "invalid-ping-role" };
  return {
    ok: true,
    value: {
      channelId: input.channelId,
      title: input.title.trim(),
      description: input.description.trim(),
      ...(typeof input.color === "string" ? { color: input.color } : {}),
      ...(typeof input.pingRoleId === "string" ? { pingRoleId: input.pingRoleId } : {}),
    },
  };
}

export function buildAnnouncePayload(guildId: string, input: AnnounceInput) {
  return {
    guild_id: guildId,
    channel_id: input.channelId,
    title: input.title,
    description: input.description,
    color: input.color ?? "#B6A0FF",
    ...(input.pingRoleId ? { content: `<@&${input.pingRoleId}>` } : {}),
  };
}

export const himikoCommandDefinitions = [
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an embed announcement to a channel (Himiko)")
    .setDMPermission(false)
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Destination text/announcement channel")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("title").setDescription("Announcement title").setMaxLength(ANNOUNCE_MAX_TITLE).setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("description").setDescription("Announcement body").setMaxLength(ANNOUNCE_MAX_DESCRIPTION).setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("color").setDescription("Hex color, e.g. #B6A0FF").setMinLength(7).setMaxLength(7),
    )
    .addRoleOption((opt) => opt.setName("ping_role").setDescription("Role to ping with the announcement")),
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Preview an embed before posting (Himiko)")
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt.setName("title").setDescription("Embed title").setMaxLength(ANNOUNCE_MAX_TITLE).setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("description").setDescription("Embed body").setMaxLength(ANNOUNCE_MAX_DESCRIPTION).setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("color").setDescription("Hex color, e.g. #E6BF75").setMinLength(7).setMaxLength(7),
    ),
];
