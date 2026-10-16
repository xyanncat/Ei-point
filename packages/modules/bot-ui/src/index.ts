import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";

const DEFAULT_IMAGE =
  "https://raw.githubusercontent.com/xyanncat/Ei-point/main/docs/assets/ei-point-pulse.gif";
const BRAND = 0x8f2938;

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

export function createEiEmbed(options: EmbedReplyOptions): EmbedBuilder {
  const imageUrl = options.imageUrl ?? resolveEmbedImage(options.imageKey);
  const embed = new EmbedBuilder()
    .setColor(options.color ?? BRAND)
    .setTitle(options.title.slice(0, 256))
    .setDescription(options.description.slice(0, 4096))
    .setImage(imageUrl)
    .setFooter({ text: "Ei Point · powered by Ei-Flow" })
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

export async function replyEiEmbed(
  interaction: ChatInputCommandInteraction,
  options: EmbedReplyOptions,
  allowOwnerPing = false,
): Promise<void> {
  const ownerId = process.env.EI_POINT_OWNER_ID?.trim();
  const allowedMentions = allowOwnerPing && ownerId && /^\d{17,20}$/.test(ownerId)
    ? { users: [ownerId] }
    : { parse: [] as const };
  const payload = {
    embeds: [createEiEmbed(options)],
    ephemeral: options.ephemeral ?? false,
    allowedMentions,
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: payload.embeds, allowedMentions: payload.allowedMentions });
    return;
  }
  await interaction.reply(payload);
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
): Promise<boolean> {
  if (!isCommonCommand(interaction.commandName)) return false;

  if (interaction.commandName === "ping") {
    await replyEiEmbed(interaction, {
      title: "Ei Point · Pong!",
      description: `Discord gateway latency: **${Math.max(0, Math.round(interaction.client.ws.ping))} ms**`,
    });
    return true;
  }

  if (interaction.commandName === "botinfo") {
    const client = interaction.client as Client<true>;
    await replyEiEmbed(interaction, {
      title: `${botName} · Bot information`,
      description: responsibilities,
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
  }, Boolean(ownerId && /^\d{17,20}$/.test(ownerId)));
  return true;
}

export function toEiEmbedPayload(text: string, title = "Ei Point", imageKey?: string) {
  return {
    embeds: [createEiEmbed({ title, description: text.trim() ? text : "No additional details.", ...(imageKey ? { imageKey } : {}) })],
    allowedMentions: { parse: [] as const },
  };
}

function payloadWithEiEmbed(input: unknown, imageKey?: string): unknown {
  if (typeof input === "string") return toEiEmbedPayload(input, "Ei Point", imageKey);
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  const imageUrl = resolveEmbedImage(imageKey);
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    if (Array.isArray(value.embeds) && value.embeds.length > 0) {
      const embeds = value.embeds.map((embed, index) => {
        if (index !== 0 || !embed || typeof embed !== "object") return embed;
        return EmbedBuilder.from(embed as never).setImage(imageUrl).toJSON();
      });
      return { ...value, embeds };
    }
    return { ...value, embeds: [createEiEmbed({ title: "Ei Point", description: "No additional details.", imageUrl })] };
  }
  const existingEmbeds = Array.isArray(value.embeds) ? value.embeds : [];
  const hasExistingEmbed = existingEmbeds.length > 0;
  if (hasExistingEmbed) {
    const [first, ...restEmbeds] = existingEmbeds;
    const branded = first && typeof first === "object"
      ? EmbedBuilder.from(first as never).setImage(imageUrl)
      : createEiEmbed({ title: "Ei Point", description: value.content, imageUrl });
    const data = branded.toJSON();
    if (!data.description && value.content) branded.setDescription(String(value.content).slice(0, 4096));
    const { content: _content, ...rest } = value;
    const brandedEmbeds = [branded.toJSON(), ...restEmbeds];
    if (data.description && value.content) {
      brandedEmbeds.push(createEiEmbed({ title: "Ei Point", description: String(value.content), imageUrl }).toJSON());
    }
    return {
      ...rest,
      embeds: brandedEmbeds,
      allowedMentions: value.allowedMentions ?? { parse: [] },
    };
  }
  const { content: _content, ...rest } = value;
  return {
    ...rest,
    embeds: [createEiEmbed({ title: "Ei Point", description: value.content, imageUrl })],
    allowedMentions: value.allowedMentions ?? { parse: [] },
  };
}

/** Wrap Discord interaction reply methods so legacy text replies become branded embeds. */
export function withEiEmbedReplies<T extends object>(interaction: T, imageKey?: string): T {
  return new Proxy(interaction, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, target);
      if (property !== "reply" && property !== "editReply" && property !== "followUp") {
        return typeof method === "function" ? method.bind(target) : method;
      }
      if (typeof method !== "function") return method;
      return (...args: unknown[]) => {
        if (args.length === 0) return Reflect.apply(method, target, args);
        return Reflect.apply(method, target, [payloadWithEiEmbed(args[0], imageKey), ...args.slice(1)]);
      };
    },
  });
}
