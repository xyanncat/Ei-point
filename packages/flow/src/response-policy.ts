// Explicit identity/operation reply policy (A08). The shared dispatcher used to
// default every reply to ephemeral, which contradicts the product contract that
// normal replies on the public bots are visible. Visibility is now resolved from
// the identity and its operation; unknown identities fail private.

export type ReplyVisibility = "public" | "private";

export interface ResponsePolicy {
  visibility: ReplyVisibility;
  /** Key for the configured reply image (per-identity override, shared fallback). */
  imageKey: string;
}

/** Product contract: normal replies for these identities are public. */
const PUBLIC_IDENTITIES = new Set(["himiko", "silverwolf", "cyrene", "robin", "cipher"]);

/** Operations that reply privately even on public identities (server configuration,
 * catalog administration, payment/order/referral detail). */
const PRIVATE_OPERATIONS: Record<string, ReadonlySet<string>> = {
  himiko: new Set(["setwelcome", "setleave", "testwelcome", "xp", "setlevelchannel"]),
  silverwolf: new Set(["setwelcome", "setleave", "testwelcome", "xp", "setlevelchannel", "cardadmin"]),
  cipher: new Set(["orders", "payment", "referral"]),
};

/**
 * Resolves the reply policy for an identity and its operation (slash command
 * name). Kafka security/moderation replies and unknown identities are always
 * private; the public identities reply visibly except for their sensitive
 * operations.
 */
export function responsePolicy(identity: string, operation?: string): ResponsePolicy {
  const key = identity.trim().toLowerCase();
  const op = (operation ?? "").trim().toLowerCase();
  const visible = PUBLIC_IDENTITIES.has(key) && !(PRIVATE_OPERATIONS[key]?.has(op) ?? false);
  return { visibility: visible ? "public" : "private", imageKey: key };
}
