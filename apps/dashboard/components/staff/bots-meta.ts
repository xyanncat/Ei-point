// Display metadata for the six bot identities. Legacy keys fall back to their
// current identity so no "X (legacy)" duplicates ever render.
import type { IconName } from "../icons";

export const BOT_META: Record<string, { name: string; summary: string; icon: IconName }> = {
  kafka: { name: "Kafka", summary: "Security & moderation", icon: "shield" },
  cyrene: { name: "Cyrene", summary: "AI chat, TTS & translation", icon: "spark" },
  robin: { name: "Robin", summary: "Music & voice sessions", icon: "music" },
  cipher: { name: "Cipher", summary: "Payments & referrals", icon: "store" },
  silverwolf: { name: "Silver Wolf", summary: "Cards, games & economy", icon: "cards" },
  himiko: { name: "Himiko", summary: "Welcomes, levels & announcements", icon: "activity" },
};

export function botsMeta(botKey: string) {
  return BOT_META[botKey] ?? { name: botKey, summary: "Assigned service", icon: "bots" as IconName };
}
