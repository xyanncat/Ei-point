export function canSettleCommerce(input: {
  isOwner: boolean;
  canManage: boolean;
  userScopes: string[];
}): boolean {
  return input.isOwner || input.canManage || input.userScopes.includes("commerce-settle");
}
