const manageServerCommands = new Set([
  "setwelcome",
  "setleave",
  "testwelcome",
  "xp",
  "setlevelchannel",
]);

export function communityCommandPermissionDenial(
  commandName: string,
  canManageServer: boolean,
  isGuildOwner: boolean,
): string | null {
  if (manageServerCommands.has(commandName) && !canManageServer) {
    return "Manage Server permission is required.";
  }
  if (commandName === "cardadmin" && !isGuildOwner) {
    return "Only the guild owner can administer cards and berries.";
  }
  return null;
}
