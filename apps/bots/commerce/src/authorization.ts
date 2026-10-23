export function canSettleCommerce(input: {
  isOwner: boolean;
  canManage: boolean;
  userScopes: string[];
  /** The master identity settles whatever it likes. */
  isMaster?: boolean | undefined;
}): boolean {
  return (
    input.isMaster === true ||
    input.isOwner ||
    input.canManage ||
    input.userScopes.includes("commerce-settle")
  );
}
