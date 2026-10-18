export type ConfigValue = string | number | boolean;
export interface ConfigField {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'boolean' | 'select';
  default?: ConfigValue; help?: string; placeholder?: string; min?: number; max?: number; step?: number;
  options?: { value: string; label: string }[];
}
// Settings are provided by the server schema; identities are display context only.
export const MODULE_LABELS: Record<string, string> = {
  moderation: 'Moderation', logging: 'Audit logging', security: 'Security',
  welcome: 'Welcomes & leave', community: 'Community', leveling: 'Levels & XP',
  games: 'Cards & economy', ai: 'AI chat & voice', search: 'Search answers',
  music: 'Music', commerce: 'Commerce', announcements: 'Announcements',
};
