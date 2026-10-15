import {
  communityEvent,
  lockApprovedGuild,
  transaction,
  type SqlPool,
} from "@ei-point/flow";
import { levelForXp, renderWelcome } from "./index.js";

export interface CommunitySettings {
  welcomeChannelId: string | null;
  welcomeTemplate: string;
  leaveChannelId: string | null;
  leaveTemplate: string;
  levelChannelId: string | null;
  xpEnabled: boolean;
  xpPerMessage: number;
  cooldownSeconds: number;
  voiceXpEnabled: boolean;
  voiceXpAmount: number;
  voiceIntervalSeconds: number;
}
export interface XpAwardResult {
  awarded: boolean;
  duplicate: boolean;
  xp: string;
  level: number;
}
export const DEFAULT_SETTINGS: CommunitySettings = {
  welcomeChannelId: null,
  welcomeTemplate: "Welcome {user} to {guild}!",
  leaveChannelId: null,
  leaveTemplate: "{user} left {guild}.",
  levelChannelId: null,
  xpEnabled: true,
  xpPerMessage: 15,
  cooldownSeconds: 60,
  voiceXpEnabled: false,
  voiceXpAmount: 5,
  voiceIntervalSeconds: 300,
};
function validate(settings: CommunitySettings): void {
  for (const channel of [
    settings.welcomeChannelId,
    settings.leaveChannelId,
    settings.levelChannelId,
  ]) {
    if (channel !== null && !/^\d{17,20}$/.test(channel))
      throw new Error("invalid-channel");
  }
  if (
    typeof settings.xpEnabled !== "boolean" ||
    !Number.isInteger(settings.xpPerMessage) ||
    settings.xpPerMessage < 1 ||
    settings.xpPerMessage > 100 ||
    !Number.isInteger(settings.cooldownSeconds) ||
    settings.cooldownSeconds < 5 ||
    settings.cooldownSeconds > 3600 ||
    typeof settings.voiceXpEnabled !== "boolean" ||
    !Number.isInteger(settings.voiceXpAmount) ||
    settings.voiceXpAmount < 1 ||
    settings.voiceXpAmount > 100 ||
    !Number.isInteger(settings.voiceIntervalSeconds) ||
    settings.voiceIntervalSeconds < 60 ||
    settings.voiceIntervalSeconds > 3600
  )
    throw new Error("invalid-xp-settings");
  for (const template of [settings.welcomeTemplate, settings.leaveTemplate])
    if (
      typeof template !== "string" ||
      template.length < 1 ||
      template.length > 1000
    )
      throw new Error("invalid-template");
}
export class CommunityService {
  constructor(private readonly pool: SqlPool) {}
  async settings(guildId: string): Promise<CommunitySettings> {
    return transaction(this.pool, async (db) => {
      await lockApprovedGuild(db, guildId);
      const r = await db.query(
        "SELECT template FROM community.welcome_templates WHERE guild_id=$1",
        [guildId],
      );
      return { ...DEFAULT_SETTINGS, ...r.rows[0]?.template };
    });
  }
  async configure(
    guildId: string,
    patch: Partial<CommunitySettings>,
  ): Promise<CommunitySettings> {
    return transaction(this.pool, async (db) => {
      await lockApprovedGuild(db, guildId);
      const r = await db.query(
        "SELECT template FROM community.welcome_templates WHERE guild_id=$1",
        [guildId],
      );
      const settings = {
        ...DEFAULT_SETTINGS,
        ...r.rows[0]?.template,
        ...patch,
      } as CommunitySettings;
      validate(settings);
      await db.query(
        `INSERT INTO community.welcome_templates(guild_id,template) VALUES ($1,$2)
        ON CONFLICT(guild_id) DO UPDATE SET template=EXCLUDED.template,updated_at=now()`,
        [guildId, JSON.stringify(settings)],
      );
      return settings;
    });
  }
  async memberEvent(input: {
    guildId: string;
    userId: string;
    userName?: string;
    guildName: string;
    memberCount: number;
    event: "join" | "leave";
    key: string;
  }): Promise<void> {
    await transaction(this.pool, async (db) => {
      await lockApprovedGuild(db, input.guildId);
      const r = await db.query(
        "SELECT template FROM community.welcome_templates WHERE guild_id=$1",
        [input.guildId],
      );
      const settings = {
        ...DEFAULT_SETTINGS,
        ...r.rows[0]?.template,
      } as CommunitySettings;
      const channelId =
        input.event === "join"
          ? settings.welcomeChannelId
          : settings.leaveChannelId;
      if (!channelId) return;
      const content = renderWelcome(
        input.event === "join"
          ? settings.welcomeTemplate
          : settings.leaveTemplate,
        {
          user: `<@${input.userId}>`,
          username: input.userName ?? input.userId,
          guild: input.guildName,
          count: input.memberCount,
        },
      ).slice(0, 2000);
      await communityEvent(db, input.guildId, input.key, {
        guildId: input.guildId,
        channelId,
        content,
        category: input.event === "join" ? "welcome" : "leave",
      });
    });
  }
  async awardXp(input: {
    guildId: string;
    userId: string;
    userName?: string;
    messageId: string;
    source?: "message" | "voice";
  }): Promise<XpAwardResult> {
    return transaction(this.pool, async (db) => {
      await lockApprovedGuild(db, input.guildId);
      const cfg = await db.query(
        "SELECT template FROM community.welcome_templates WHERE guild_id=$1",
        [input.guildId],
      );
      const settings = {
        ...DEFAULT_SETTINGS,
        ...cfg.rows[0]?.template,
      } as CommunitySettings;
      const source = input.source ?? "message";
      const enabled = source === "message" ? settings.xpEnabled : settings.voiceXpEnabled;
      const amount = source === "message" ? settings.xpPerMessage : settings.voiceXpAmount;
      const cooldownSeconds = source === "message" ? settings.cooldownSeconds : settings.voiceIntervalSeconds;
      const cooldownColumn = source === "message" ? "last_awarded_at" : "last_voice_awarded_at";
      const seen = await db.query(
        "INSERT INTO community.xp_events(guild_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [input.guildId, input.messageId],
      );
      await db.query(
        "INSERT INTO community.xp(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [input.guildId, input.userId],
      );
      const old = (
        await db.query(
          "SELECT xp,level,last_awarded_at,last_voice_awarded_at FROM community.xp WHERE guild_id=$1 AND user_id=$2",
          [input.guildId, input.userId],
        )
      ).rows[0]!;
      if (seen.rowCount === 0)
        return { awarded: false, duplicate: true, xp: String(old.xp), level: old.level };
      if (!enabled)
        return { awarded: false, duplicate: false, xp: String(old.xp), level: old.level };
      const updated = await db.query(
        `UPDATE community.xp SET xp=xp+$3,${cooldownColumn}=now(),updated_at=now()
        WHERE guild_id=$1 AND user_id=$2 AND (${cooldownColumn} IS NULL OR ${cooldownColumn} <= now()-make_interval(secs=>$4)) RETURNING xp`,
        [
          input.guildId,
          input.userId,
          amount,
          cooldownSeconds,
        ],
      );
      if (!updated.rows[0])
        return { awarded: false, duplicate: false, xp: String(old.xp), level: old.level };
      const xp = String(updated.rows[0].xp),
        level = levelForXp(Number(xp));
      await db.query(
        "UPDATE community.xp SET level=$3 WHERE guild_id=$1 AND user_id=$2",
        [input.guildId, input.userId, level],
      );
      if (level > old.level && settings.levelChannelId)
        await communityEvent(db, input.guildId, `level:${input.messageId}`, {
          guildId: input.guildId,
          channelId: settings.levelChannelId,
          category: "leveling",
          content: `<@${input.userId}> reached level ${level}!`,
        });
      return { awarded: true, duplicate: false, xp, level };
    });
  }
  async rank(
    guildId: string,
    userId: string,
  ): Promise<{ xp: string; level: number; rank: number }> {
    return transaction(this.pool, async (db) => {
      await lockApprovedGuild(db, guildId);
      // Fetch only this user's rank while keeping tie ordering deterministic.
      const result = await db.query(
        `SELECT xp,level,rank FROM (SELECT user_id,xp,level,row_number() OVER(ORDER BY xp DESC,user_id) AS rank FROM community.xp WHERE guild_id=$1) ranks WHERE user_id=$2`,
        [guildId, userId],
      );
      const value = result.rows[0];
      return value
        ? { xp: String(value.xp), level: value.level, rank: Number(value.rank) }
        : { xp: "0", level: 0, rank: 0 };
    });
  }
  async leaderboard(
    guildId: string,
    limit = 10,
  ): Promise<Record<string, any>[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25)
      throw new Error("invalid-page");
    return transaction(this.pool, async (db) => {
      await lockApprovedGuild(db, guildId);
      return (
        await db.query(
          'SELECT user_id AS "userId",xp,level FROM community.xp WHERE guild_id=$1 ORDER BY xp DESC,user_id LIMIT $2',
          [guildId, limit],
        )
      ).rows;
    });
  }
}
