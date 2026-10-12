import { ChannelType, SlashCommandBuilder } from "discord.js";
import {
  renderWelcome,
  type CommunityService,
} from "@ei-point/module-community";
import type { EconomyService } from "@ei-point/module-games";

export interface CommandRequest {
  name: string;
  subcommand?: string;
  options: Record<string, string | number | boolean>;
  guildId: string;
  userId: string;
  key: string;
  isOwner: boolean;
  canManage: boolean;
  defer(): Promise<void>;
  reply(text: string): Promise<void>;
}
export interface CommandServices {
  community: CommunityService;
  economy: EconomyService;
}
const text = (r: CommandRequest, key: string): string =>
  String(r.options[key] ?? "");
const num = (r: CommandRequest, key: string, fallback: number): number =>
  Number(r.options[key] ?? fallback);
const list = (r: CommandRequest, key: string): string[] =>
  text(r, key)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const simple = (name: string, description: string) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDMPermission(false);
const page = (c: SlashCommandBuilder) =>
  c.addIntegerOption((o) =>
    o
      .setName("page")
      .setDescription("Page number")
      .setMinValue(1)
      .setMaxValue(10000),
  );
export const commandDefinitions = [
  ...["welcome", "leave"].map((event) =>
    simple(`set${event}`, `Configure ${event} messages`)
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Destination channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("message")
          .setDescription("Use {user}, {guild}, {count}")
          .setMaxLength(1000)
          .setRequired(true),
      ),
  ),
  simple("testwelcome", "Preview a welcome or leave message").addStringOption(
    (o) =>
      o
        .setName("event")
        .setDescription("Which template")
        .addChoices(
          { name: "Welcome", value: "join" },
          { name: "Leave", value: "leave" },
        ),
  ),
  simple("xp", "Configure message XP")
    .addBooleanOption((o) => o.setName("enabled").setDescription("Enable XP"))
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("XP per message")
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addIntegerOption((o) =>
      o
        .setName("cooldown")
        .setDescription("Cooldown in seconds")
        .setMinValue(5)
        .setMaxValue(3600),
    ),
  simple(
    "setlevelchannel",
    "Choose the level-up notification channel",
  ).addChannelOption((o) =>
    o
      .setName("channel")
      .setDescription("Destination")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  ),
  simple("rank", "Show XP, level and rank").addUserOption((o) =>
    o.setName("user").setDescription("Member to inspect"),
  ),
  simple("leaderboard", "Show the top ten members"),
  page(simple("cards", "Browse the card catalog")),
  page(simple("inventory", "Show your card instances")),
  simple("packs", "Show available packs"),
  simple("open", "Open a pack at its server-defined price").addStringOption(
    (o) =>
      o
        .setName("pack")
        .setDescription("Pack ID")
        .setMaxLength(100)
        .setRequired(true),
  ),
  simple("sell", "List a card for sale")
    .addStringOption((o) =>
      o
        .setName("instance")
        .setDescription("Card instance UUID")
        .setMaxLength(36)
        .setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("price")
        .setDescription("Price in berries")
        .setMinValue(1)
        .setRequired(true),
    ),
  page(simple("market", "Browse open listings")),
  simple("buy", "Purchase a listing").addStringOption((o) =>
    o
      .setName("listing")
      .setDescription("Listing UUID")
      .setMaxLength(36)
      .setRequired(true),
  ),
  simple("trades", "Show your pending and completed trades").addIntegerOption(
    (o) =>
      o
        .setName("page")
        .setDescription("Page number")
        .setMinValue(1)
        .setMaxValue(10000),
  ),
  simple("trade", "Offer, accept or cancel a trade")
    .addSubcommand((s) =>
      s
        .setName("offer")
        .setDescription("Offer cards and berries")
        .addUserOption((o) =>
          o
            .setName("recipient")
            .setDescription("Trade partner")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("offered")
            .setDescription("Comma-separated instance UUIDs")
            .setMaxLength(739),
        )
        .addStringOption((o) =>
          o
            .setName("requested")
            .setDescription("Comma-separated instance UUIDs")
            .setMaxLength(739),
        )
        .addIntegerOption((o) =>
          o
            .setName("offered_amount")
            .setDescription("Berries offered")
            .setMinValue(0),
        )
        .addIntegerOption((o) =>
          o
            .setName("requested_amount")
            .setDescription("Berries requested")
            .setMinValue(0),
        )
        .addIntegerOption((o) =>
          o
            .setName("ttl")
            .setDescription("Expires in minutes")
            .setMinValue(1)
            .setMaxValue(10080),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("accept")
        .setDescription("Accept an offer addressed to you")
        .addStringOption((o) =>
          o
            .setName("id")
            .setDescription("Trade UUID")
            .setRequired(true)
            .setMaxLength(36),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("cancel")
        .setDescription("Cancel or reject an offer")
        .addStringOption((o) =>
          o
            .setName("id")
            .setDescription("Trade UUID")
            .setRequired(true)
            .setMaxLength(36),
        ),
    ),
  simple("cardadmin", "Guild-owner catalog and economy administration")
    .addSubcommand((s) =>
      s
        .setName("credit")
        .setDescription("Grant berries")
        .addUserOption((o) =>
          o.setName("user").setDescription("Recipient").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("amount")
            .setDescription("Berries")
            .setMinValue(1)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("issue")
        .setDescription("Issue a card subject to supply")
        .addUserOption((o) =>
          o.setName("user").setDescription("Recipient").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("card").setDescription("Card ID").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("define")
        .setDescription("Import a card definition JSON")
        .addStringOption((o) =>
          o
            .setName("json")
            .setDescription("cardId,name,rarity,artworkRef,checksum,maxSupply")
            .setMaxLength(2000)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("pack")
        .setDescription("Configure a pack JSON")
        .addStringOption((o) =>
          o
            .setName("json")
            .setDescription(
              "packId,name,price,size,adminOnly,items:[{cardId,weight}]",
            )
            .setMaxLength(2000)
            .setRequired(true),
        ),
    ),
].concat([
  simple("unlist", "Cancel your open listing").addStringOption((o) =>
    o
      .setName("listing")
      .setDescription("Listing UUID")
      .setRequired(true)
      .setMaxLength(36),
  ),
  simple("balance", "Show your berries"),
]);

function rowsText(rows: Record<string, any>[], empty: string): string {
  return rows.length
    ? rows
        .map((row) =>
          Object.entries(row)
            .map(([key, value]) => `${key}: ${value}`)
            .join(" | "),
        )
        .join("\n")
        .slice(0, 1900)
    : empty;
}
const PUBLIC_ERRORS: Record<string, string> = {
  "guild-not-approved": "This server is not approved.",
  "card-unavailable": "That card is unavailable or already reserved.",
  "listing-unavailable": "That listing is no longer available.",
  "self-buy": "You already own this listing.",
  "insufficient-funds":
    "Insufficient berries. The transaction was rolled back.",
  "trade-unavailable": "That trade is closed or expired.",
  "recipient-required": "Only the recipient can accept this trade.",
  "admin-required": "Only the guild owner can open this pack.",
  "pack-unavailable": "That pack is unavailable.",
  "pack-exhausted": "The pack has insufficient remaining supply.",
  "card-exhausted": "The card is unavailable or its supply is exhausted.",
  "invalid-trade": "Check the recipient, cards, amounts and expiry.",
  "trade-limit": "Cancel existing pending offers before creating more.",
  "idempotency-conflict":
    "This request ID was already used for a different action.",
};
export async function respondToCommand(
  r: CommandRequest,
  services: CommandServices,
): Promise<void> {
  await r.defer(); // Acknowledgement precedes every database query.
  const actor = { guildId: r.guildId, userId: r.userId, key: r.key };
  let response: string;
  try {
    const c = services.community,
      g = services.economy;
    if (
      [
        "setwelcome",
        "setleave",
        "testwelcome",
        "xp",
        "setlevelchannel",
      ].includes(r.name) &&
      !r.canManage
    ) {
      await r.reply("Manage Server permission is required.");
      return;
    }
    if (r.name === "cardadmin" && !r.isOwner) {
      await r.reply("Only the guild owner can administer cards and berries.");
      return;
    }
    if (r.name === "cardadmin") await c.settings(r.guildId); // Recheck approval before privileged catalog writes.
    switch (r.name) {
      case "setwelcome":
        await c.configure(r.guildId, {
          welcomeChannelId: text(r, "channel"),
          welcomeTemplate: text(r, "message"),
        });
        response = "Welcome settings saved.";
        break;
      case "setleave":
        await c.configure(r.guildId, {
          leaveChannelId: text(r, "channel"),
          leaveTemplate: text(r, "message"),
        });
        response = "Leave settings saved.";
        break;
      case "setlevelchannel":
        await c.configure(r.guildId, { levelChannelId: text(r, "channel") });
        response = "Level-up channel saved.";
        break;
      case "testwelcome": {
        const s = await c.settings(r.guildId);
        response = renderWelcome(
          text(r, "event") === "leave" ? s.leaveTemplate : s.welcomeTemplate,
          {
            user: `<@${r.userId}>`,
            username: text(r, "username") || r.userId,
            guild: text(r, "guild_name") || "this server",
            count: num(r, "member_count", 0),
          },
        );
        break;
      }
      case "xp": {
        const patch: Record<string, any> = {};
        if (r.options.enabled !== undefined)
          patch.xpEnabled = r.options.enabled;
        if (r.options.amount !== undefined)
          patch.xpPerMessage = r.options.amount;
        if (r.options.cooldown !== undefined)
          patch.cooldownSeconds = r.options.cooldown;
        await c.configure(r.guildId, patch);
        response = "XP settings saved.";
        break;
      }
      case "rank": {
        const rank = await c.rank(r.guildId, text(r, "user") || r.userId);
        response = `XP: ${rank.xp} | Level: ${rank.level} | Rank: ${rank.rank || "unranked"}`;
        break;
      }
      case "leaderboard":
        response = rowsText(
          await c.leaderboard(r.guildId),
          "No XP earned yet.",
        );
        break;
      case "balance":
        response = `Berries: ${await g.balance(r.guildId, r.userId)}`;
        break;
      case "cards":
        response = rowsText(
          await g.catalog(r.guildId, num(r, "page", 1)),
          "No cards on this page. Ask the guild owner to import the catalog.",
        );
        break;
      case "inventory":
        response = rowsText(
          await g.inventory(r.guildId, r.userId, num(r, "page", 1)),
          "No cards on this page.",
        );
        break;
      case "packs":
        response = rowsText(await g.packs(r.guildId), "No packs configured.");
        break;
      case "open":
        response = `Pack opened: ${JSON.stringify(await g.openPack({ ...actor, packId: text(r, "pack"), isAdmin: r.isOwner }))}`;
        break;
      case "sell":
        response = `Listing created: ${(await g.createListing({ ...actor, instanceId: text(r, "instance"), price: num(r, "price", 0) })).listingId}`;
        break;
      case "market":
        response = rowsText(
          await g.market(r.guildId, num(r, "page", 1)),
          "No open listings on this page.",
        );
        break;
      case "buy":
        response = `Purchased: ${JSON.stringify(await g.buy({ ...actor, listingId: text(r, "listing") }))}`;
        break;
      case "unlist":
        await g.cancelListing({ ...actor, listingId: text(r, "listing") });
        response = "Listing cancelled.";
        break;
      case "trades":
        response = rowsText(
          await g.trades(r.guildId, r.userId, num(r, "page", 1)),
          "No trades on this page.",
        );
        break;
      case "trade": {
        if (r.subcommand === "offer")
          response = `Trade offered: ${(await g.offerTrade({ ...actor, recipientId: text(r, "recipient"), offered: list(r, "offered"), requested: list(r, "requested"), offeredAmount: num(r, "offered_amount", 0), requestedAmount: num(r, "requested_amount", 0), ttlMinutes: num(r, "ttl", 1440) })).tradeId}`;
        else if (r.subcommand === "accept") {
          await g.acceptTrade({ ...actor, tradeId: text(r, "id") });
          response = "Trade completed.";
        } else if (r.subcommand === "cancel") {
          await g.cancelTrade({ ...actor, tradeId: text(r, "id") });
          response = "Trade cancelled.";
        } else throw new Error("unknown-command");
        break;
      }
      case "cardadmin": {
        if (r.subcommand === "credit") {
          await g.credit({
            ...actor,
            userId: text(r, "user"),
            amount: num(r, "amount", 0),
          });
          response = "Berries granted.";
        } else if (r.subcommand === "issue")
          response = `Card issued: ${JSON.stringify(await g.issueCard({ ...actor, userId: text(r, "user"), cardId: text(r, "card") }))}`;
        else if (r.subcommand === "define") {
          await g.defineCard(JSON.parse(text(r, "json")));
          response = "Card definition saved.";
        } else if (r.subcommand === "pack") {
          await g.definePack(JSON.parse(text(r, "json")));
          response = "Pack saved.";
        } else throw new Error("unknown-command");
        break;
      }
      default:
        response = "Unknown command.";
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    response =
      PUBLIC_ERRORS[code] ??
      (code.startsWith("invalid-") || error instanceof SyntaxError
        ? "Invalid input. Check the supplied values."
        : `The operation could not be confirmed. Check your inventory or balance before retrying. Reference: ${r.key}`);
  }
  await r.reply(response.slice(0, 2000));
}
