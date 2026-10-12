export type ConfigValue = string | number | boolean;
export interface ConfigField {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'boolean' | 'select';
  default?: ConfigValue; help?: string; placeholder?: string; min?: number; max?: number; step?: number;
  options?: { value: string; label: string }[];
}
// Settings are provided by the server schema; identities are display context only.
export const MODULE_LABELS: Record<string, string> = {
  moderation: 'Moderation · Shanks', logging: 'Audit logging · Sanji', security: 'Security · Zoro',
  welcome: 'Welcome · Boa Hancock', community: 'Community · Boa Hancock & Nami', leveling: 'Leveling · Nami',
  games: 'Games · Luffy', ai: 'AI · Cyrene', search: 'Search · Nico Robin', music: 'Music', commerce: 'Commerce',
};
