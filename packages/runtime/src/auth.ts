// Auth: guild allowlist + staff scopes (§5 step 2). Cache failure never grants access (§4).
export function isGuildApproved(guildId: string | null, allowlist: string[]): boolean {
  if (guildId == null) return false;
  return allowlist.includes(guildId);
}

export function hasScope(granted: string[], required: string): boolean {
  return granted.includes(required);
}
