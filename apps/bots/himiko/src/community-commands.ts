import { ChannelType, SlashCommandBuilder } from "discord.js";
import { renderWelcome, type CommunityService, type CommunitySettings } from "@ei-point/module-community";

const simple = (name: string, description: string) =>
  new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);

export const COMMUNITY_ADMIN_COMMANDS = new Set([
  "setwelcome",
  "setleave",
  "testwelcome",
  "xp",
  "setlevelchannel",
]);

export const communityCommandDefinitions = [
  ...(["welcome", "leave"] as const).map((event) =>
    simple(`set${event}`, `Configure ${event} messages`)
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Destination channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("Template supports {user}, {username}, {guild}, and {count}")
          .setMaxLength(1000)
          .setRequired(true),
      ),
  ),
  simple("testwelcome", "Preview a welcome or leave message")
    .addStringOption((option) =>
      option
        .setName("event")
        .setDescription("Which template to preview")
        .addChoices(
          { name: "Welcome", value: "join" },
          { name: "Leave", value: "leave" },
        ),
    ),
  simple("xp", "Configure text and voice experience")
    .addBooleanOption((option) => option.setName("enabled").setDescription("Enable text message XP"))
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("XP per eligible text message").setMinValue(1).setMaxValue(100),
    )
    .addIntegerOption((option) =>
      option.setName("cooldown").setDescription("Minimum seconds between awards per XP source").setMinValue(5).setMaxValue(3600),
    )
    .addBooleanOption((option) => option.setName("voice_enabled").setDescription("Enable voice participation XP"))
    .addIntegerOption((option) =>
      option.setName("voice_amount").setDescription("XP per eligible voice interval").setMinValue(1).setMaxValue(100),
    )
    .addIntegerOption((option) =>
      option.setName("voice_interval").setDescription("Seconds between voice XP awards").setMinValue(60).setMaxValue(3600),
    ),
  simple("setlevelchannel", "Choose the level-up notification channel").addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Destination")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  ),
  simple("leaderboard", "Show the top ten members by XP"),
];

export interface CommunityCommandInput {
  name: string;
  guildId: string;
  userId: string;
  username: string;
  guildName: string;
  memberCount: number;
  options: Record<string, string | number | boolean>;
}

export async function respondToCommunityCommand(
  input: CommunityCommandInput,
  community: CommunityService,
): Promise<string | null> {
  const value = (key: string) => input.options[key];
  switch (input.name) {
    case "setwelcome":
      await community.configure(input.guildId, {
        welcomeChannelId: String(value("channel") ?? ""),
        welcomeTemplate: String(value("message") ?? ""),
      });
      return "Welcome settings saved.";
    case "setleave":
      await community.configure(input.guildId, {
        leaveChannelId: String(value("channel") ?? ""),
        leaveTemplate: String(value("message") ?? ""),
      });
      return "Leave settings saved.";
    case "setlevelchannel":
      await community.configure(input.guildId, { levelChannelId: String(value("channel") ?? "") });
      return "Level-up channel saved.";
    case "testwelcome": {
      const settings = await community.settings(input.guildId);
      return renderWelcome(value("event") === "leave" ? settings.leaveTemplate : settings.welcomeTemplate, {
        user: `<@${input.userId}>`,
        username: input.username,
        guild: input.guildName,
        count: input.memberCount,
      });
    }
    case "xp": {
      const patch: Partial<CommunitySettings> = {};
      if (typeof value("enabled") === "boolean") patch.xpEnabled = value("enabled") as boolean;
      if (typeof value("amount") === "number") patch.xpPerMessage = value("amount") as number;
      if (typeof value("cooldown") === "number") patch.cooldownSeconds = value("cooldown") as number;
      if (typeof value("voice_enabled") === "boolean") patch.voiceXpEnabled = value("voice_enabled") as boolean;
      if (typeof value("voice_amount") === "number") patch.voiceXpAmount = value("voice_amount") as number;
      if (typeof value("voice_interval") === "number") patch.voiceIntervalSeconds = value("voice_interval") as number;
      await community.configure(input.guildId, patch);
      return "Text and voice XP settings saved.";
    }
    case "leaderboard": {
      const rows = await community.leaderboard(input.guildId, 10);
      return rows.length
        ? rows.map((row, index) => `**${index + 1}.** <@${row.userId}> · Level ${row.level} · ${row.xp} XP`).join("\n")
        : "No XP earned yet.";
    }
    default:
      return null;
  }
}
