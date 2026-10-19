import {
  EmbedBuilder,
  MessageFlags,
  MessageFlagsBitField,
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  type APIContainerComponent,
  type ChatInputCommandInteraction,
  type Client,
  type MessageMentionOptions,
} from "discord.js";

const DEFAULT_IMAGE =
  "https://raw.githubusercontent.com/xyanncat/Ei-point/main/docs/assets/ei-point-pulse.gif";

/** Per-identity character themes (owner request 2026-10-18), grounded in each
 *  bot's own artwork in `project assets/bots/<Bot>/embed.png`. Colours are retained
 *  as identity data but are no longer sent: the owner asked for colourless cards. */
export const IDENTITY_THEMES = {
  kafka: { color: 0xe0202f, emoji: "🕷️", name: "Kafka" },
  cyrene: { color: 0xce86e0, emoji: "🌸", name: "Cyrene" },
  robin: { color: 0x9078d8, emoji: "🕊️", name: "Robin" },
  cipher: { color: 0x2e5fd0, emoji: "🐱", name: "Cipher" },
  silverwolf: { color: 0x9152e0, emoji: "🐺", name: "Silver Wolf" },
  himiko: { color: 0xb0304c, emoji: "🌹", name: "Himiko" },
} as const;

export type IdentityTheme = { color: number; emoji: string; name: string };

/** Resolve the character theme for an identity key (blank/unknown -> undefined). */
export function identityTheme(imageKey?: string): IdentityTheme | undefined {
  const key = imageKey?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!key) return undefined;
  return (IDENTITY_THEMES as Record<string, IdentityTheme>)[key];
}

export interface EmbedReplyOptions {
  title: string;
  description: string;
  color?: number;
  ephemeral?: boolean;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  imageUrl?: string;
  /** Identity key for the configured image (per-identity override, shared fallback). */
  imageKey?: string;
}

/** Resolves the configured reply image: per-identity override, shared URL, brand default. */
export function resolveEmbedImage(imageKey?: string): string {
  const key = imageKey?.trim();
  if (key) {
    const override = process.env[`EI_POINT_EMBED_IMAGE_${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`]?.trim();
    if (override) return override;
  }
  return process.env.EI_POINT_EMBED_IMAGE_URL?.trim() || DEFAULT_IMAGE;
}

/** Intermediate legacy builder; its data is converted to Components V2 before sending.
 *  No colour is set, per the owner's "no colour" instruction. */
export function createEiEmbed(options: EmbedReplyOptions): EmbedBuilder {
  const imageUrl = options.imageUrl ?? resolveEmbedImage(options.imageKey);
  const theme = identityTheme(options.imageKey);
  const embed = new EmbedBuilder()
    .setTitle(theme ? `${theme.emoji} ${options.title.slice(0, 250)}` : options.title.slice(0, 256))
    .setDescription(options.description.slice(0, 4096))
    .setImage(imageUrl)
    .setFooter({ text: theme ? `${theme.emoji} ${theme.name} · Ei Point · powered by Ei-Flow` : "Ei Point · powered by Ei-Flow" })
    .setTimestamp();
  if (options.fields?.length) {
    embed.addFields(options.fields.slice(0, 25).map((field) => ({
      name: field.name.slice(0, 256),
      value: field.value.slice(0, 1024),
      inline: field.inline,
    })));
  }
  return embed;
}

/** Components V2 card whose media is played with Discord's native controls
 *  (video/audio media inside a Media Gallery), with no file-download tile. */
export interface VoiceMediaCardOptions {
  title: string;
  description: string;
  /** attachment://… URL of the media uploaded with the same message. */
  mediaUrl: string;
  imageKey?: string;
}

export function createVoiceMediaCard(options: VoiceMediaCardOptions) {
  const theme = identityTheme(options.imageKey);
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${theme ? `${theme.emoji} ` : ""}${options.title}\n${options.description}`,
      ),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(options.mediaUrl)
          .setDescription("Cyrene voice clip with still artwork"),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 as number };
}

export async function replyEiEmbed(
  interaction: ChatInputCommandInteraction,
  options: EmbedReplyOptions,
  allowOwnerPing = false,
): Promise<void> {
  const ownerId = process.env.EI_POINT_OWNER_ID?.trim();
  const allowedMentions = allowOwnerPing && ownerId && /^\d{17,20}$/.test(ownerId)
    ? { users: [ownerId] }
    : { parse: [] as const };
  const payload = toEiComponentPayload(
    { embeds: [createEiEmbed(options)], allowedMentions },
    options.imageKey,
  );
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload as never);
    return;
  }
  await interaction.reply({ ...payload, flags: payload.flags | (options.ephemeral ? MessageFlags.Ephemeral : 0) } as never);
}

export function commonCommandDefinitions() {
  return [
    new SlashCommandBuilder().setName("botinfo").setDescription("Show this bot's identity and status"),
    new SlashCommandBuilder().setName("ping").setDescription("Check this bot's Discord gateway latency"),
    new SlashCommandBuilder().setName("about").setDescription("About Ei Point and Ei-Flow"),
  ];
}

export function isCommonCommand(name: string): boolean {
  return name === "botinfo" || name === "ping" || name === "about";
}

export async function respondToCommonCommand(
  interaction: ChatInputCommandInteraction,
  botName: string,
  responsibilities: string,
  imageKey?: string,
): Promise<boolean> {
  if (!isCommonCommand(interaction.commandName)) return false;
  // Common commands must still carry the calling bot's identity art/footer.
  const identityKey = imageKey ?? botName.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (interaction.commandName === "ping") {
    await replyEiEmbed(interaction, {
      title: "Ei Point · Pong!",
      description: `Discord gateway latency: **${Math.max(0, Math.round(interaction.client.ws.ping))} ms**`,
      ...(identityKey ? { imageKey: identityKey } : {}),
    });
    return true;
  }

  if (interaction.commandName === "botinfo") {
    const client = interaction.client as Client<true>;
    await replyEiEmbed(interaction, {
      title: `${botName} · Bot information`,
      description: responsibilities,
      ...(identityKey ? { imageKey: identityKey } : {}),
      fields: [
        { name: "Identity", value: client.user.tag, inline: true },
        { name: "Servers", value: String(client.guilds.cache.size), inline: true },
        { name: "Uptime", value: `${Math.floor(process.uptime() / 60)} minutes`, inline: true },
      ],
    });
    return true;
  }

  const ownerId = process.env.EI_POINT_OWNER_ID?.trim();
  const ownerMention = ownerId && /^\d{17,20}$/.test(ownerId)
    ? `<@${ownerId}>`
    : "the project owner (owner ID is not configured yet)";
  await replyEiEmbed(interaction, {
    title: "About Ei Point",
    description: `**Ei Point** is a coordinated Discord platform for community, moderation, games, commerce, music, and voice. **Ei-Flow** provides shared interaction controls, lifecycle handling, and reliable domain workflows.\n\nProject owner: ${ownerMention}`,
    ...(identityKey ? { imageKey: identityKey } : {}),
  }, Boolean(ownerId && /^\d{17,20}$/.test(ownerId)));
  return true;
}

type Payload = Record<string, unknown>;

function json(value: unknown): Payload {
  if (value && typeof value === "object" && "toJSON" in value) return (value as { toJSON(): Payload }).toJSON();
  return (value ?? {}) as Payload;
}

/** Compatibility name for callers; all output uses Components V2. */
export function toEiEmbedPayload(text: string, title = "Ei Point", imageKey?: string) {
  return toEiComponentPayload({ embeds: [createEiEmbed({ title, description: text.trim() ? text : "No additional details.", ...(imageKey ? { imageKey } : {}) })] }, imageKey);
}

/** Convert legacy replies at the boundary into a colourless Components V2 container,
 *  retaining uploads, controls, mention policy and ephemeral flags. */
export function toEiComponentPayload(input: string | Payload, imageKey?: string) {
  const value: Payload = typeof input === "string" ? { content: input } : input;
  const { content, embeds, ephemeral, flags, components, ...rest } = value;
  const bits = flags === undefined ? 0 : typeof flags === "number" ? flags : new MessageFlagsBitField(flags as never).bitfield;
  const allowedMentions = (value.allowedMentions ?? { parse: [] }) as MessageMentionOptions;
  if (bits & MessageFlags.IsComponentsV2) {
    // Idempotent: repeated wrapping must not duplicate containers.
    return { ...rest, components: components as APIContainerComponent[], flags: bits | (ephemeral ? MessageFlags.Ephemeral : 0), allowedMentions };
  }

  const children: APIContainerComponent["components"] = [];
  let remaining = 3600; // Leave room for the footer within Discord's total text limit.
  const text = (body: string) => {
    const fitted = body.slice(0, remaining);
    if (fitted.trim()) { children.push({ type: 10, content: fitted }); remaining -= fitted.length; }
  };
  if (typeof content === "string") text(content);
  const images: string[] = [];
  let footer: string | undefined;
  for (const item of Array.isArray(embeds) ? embeds : []) {
    const embed = json(item);
    if (typeof embed.title === "string") text(`### ${embed.title}`);
    if (typeof embed.description === "string") text(embed.description);
    for (const field of Array.isArray(embed.fields) ? embed.fields : []) text(`**${field.name}**\n${field.value}`);
    const image = embed.image as { url?: string } | undefined;
    if (image?.url) images.push(image.url);
    const embedFooter = embed.footer as { text?: string } | undefined;
    if (!footer && embedFooter?.text) footer = embedFooter.text;
  }
  if (!children.length) text("No additional details.");
  const combinedText = children.map((child) => (child.type === 10 ? (child as { content: string }).content : "")).join("\n\n");
  children.splice(0, children.length, { type: 10, content: combinedText });
  if (!images.length) images.push(resolveEmbedImage(imageKey));
  children.push({ type: 12, items: [...new Set(images)].slice(0, 10).map((url) => ({ media: { url } })) });
  for (const file of Array.isArray(value.files) ? value.files : []) {
    const data = json(file);
    const name = typeof data.name === "string" ? data.name : typeof file === "string" ? file.split(/[\\/]/).pop() : undefined;
    if (name) children.push({ type: 13, file: { url: `attachment://${name}` } });
  }
  children.push({ type: 14, divider: true, spacing: 1 });
  const theme = identityTheme(imageKey);
  children.push({ type: 10, content: `-# ${footer ?? (theme ? `${theme.emoji} ${theme.name} · Ei Point · powered by Ei-Flow` : "Ei Point · powered by Ei-Flow")}` });
  const rows = (Array.isArray(components) ? components : []).map(json);
  // Action rows fit inside the container; preserve other layouts at the top level.
  const nestedRows = rows.filter((row) => row.type === 1) as unknown as APIContainerComponent["components"];
  children.push(...nestedRows);
  // No accent_color: the owner requested colourless cards.
  const container: APIContainerComponent = { type: 17, components: children };
  return {
    ...rest,
    components: [container, ...rows.filter((row) => row.type !== 1)] as APIContainerComponent[],
    flags: bits | MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions,
  };
}

/** Wrap shared interaction responses, including edits and component updates. */
export function withEiEmbedReplies<T extends object>(interaction: T, imageKey?: string): T {
  return new Proxy(interaction, {
    get(target, property) {
      const method = Reflect.get(target, property, target);
      if (property !== "reply" && property !== "editReply" && property !== "followUp" && property !== "update") {
        return typeof method === "function" ? method.bind(target) : method;
      }
      if (typeof method !== "function") return method;
      return (...args: unknown[]) => {
        if (!args.length) return Reflect.apply(method, target, args);
        return Reflect.apply(method, target, [toEiComponentPayload(args[0] as string | Payload, imageKey), ...args.slice(1)]);
      };
    },
  });
}
