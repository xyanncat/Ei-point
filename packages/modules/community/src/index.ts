// Community module: welcomes, announcements/embeds, XP + levels, leaderboards
// (§2 community bot, §4 community.*). Pure logic + SQL; no discord.js here.

// --- Welcome templates: {user} {guild} {count} tokens; unknown tokens untouched. ---
export function renderWelcome(
  template: string,
  vars: { user: string; guild: string; count: number },
): string {
  return template
    .split("{user}")
    .join(vars.user)
    .split("{guild}")
    .join(vars.guild)
    .split("{count}")
    .join(String(vars.count));
}

// --- Embed builder with Discord limits (title ≤256, description ≤4096, fields ≤25). ---
export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title: string;
  description: string;
  fields: EmbedField[];
  color: number | null;
}

export function buildEmbed(input: {
  title: string;
  description: string;
  fields?: EmbedField[];
  color?: number;
}): Embed | null {
  if (input.title.length === 0 || input.title.length > 256) return null;
  if (input.description.length === 0 || input.description.length > 4096) return null;
  const fields = input.fields ?? [];
  if (fields.length > 25) return null;
  for (const f of fields) {
    if (f.name.length === 0 || f.name.length > 256) return null;
    if (f.value.length === 0 || f.value.length > 1024) return null;
  }
  return {
    title: input.title,
    description: input.description,
    fields,
    color: input.color ?? null,
  };
}

// --- XP: cumulative triangular curve. Level n needs 50*n*(n+1) total XP. ---
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp < 0) return 0;
  let level = 0;
  while (50 * (level + 1) * (level + 2) <= xp) level++;
  return level;
}

export function addXp(currentXp: number, delta: number): { xp: number; level: number; leveledUp: boolean } {
  const before = levelForXp(currentXp);
  // Negative deltas spend XP but never below zero; NaN/non-finite deltas are ignored.
  const xp = Number.isFinite(delta) ? Math.max(0, currentXp + Math.floor(delta)) : Math.max(0, currentXp);
  const level = levelForXp(xp);
  return { xp, level, leveledUp: level > before };
}

export const UPSERT_XP_SQL = `
  INSERT INTO community.xp (guild_id, user_id, xp, level, updated_at)
  VALUES ($1, $2, $3, $4, now())
  ON CONFLICT (guild_id, user_id) DO UPDATE
    SET xp = EXCLUDED.xp, level = EXCLUDED.level, updated_at = now()`;

export const LEADERBOARD_SQL = `
  SELECT user_id, xp, level FROM community.xp
  WHERE guild_id = $1 ORDER BY xp DESC LIMIT $2`;

export const SAVE_WELCOME_SQL = `
  INSERT INTO community.welcome_templates (guild_id, template, updated_at)
  VALUES ($1, $2, now())
  ON CONFLICT (guild_id) DO UPDATE SET template = EXCLUDED.template, updated_at = now()`;
