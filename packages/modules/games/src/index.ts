// Games/economy module: packs, inventories, balances, market, trades
// (§2 community bot, §4 games.*). Double-spend safety via row locks + idempotency keys.

export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

const PACK_WEIGHTS: Record<Rarity, number> = {
  common: 70,
  rare: 20,
  epic: 7,
  legendary: 2.5,
  mythic: 0.5,
};

const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary", "mythic"];

// Deterministic draw from an injectable RNG (tests seed it; prod uses Math.random).
export function drawRarity(rng: () => number): Rarity {
  const total = Object.values(PACK_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const rarity of RARITY_ORDER) {
    roll -= PACK_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return "common";
}

export function drawPack(rng: () => number, size: number): Rarity[] {
  return Array.from({ length: Math.max(0, Math.floor(size)) }, () => drawRarity(rng));
}

// --- Trades: pending -> done | cancelled. Terminal states reject everything. ---
export type TradeStatus = "pending" | "done" | "cancelled";
export type TradeAction = "accept" | "cancel";

export function tradeTransition(status: TradeStatus, action: TradeAction): TradeStatus | null {
  if (status !== "pending") return null;
  return action === "accept" ? "done" : "cancelled";
}

// --- SQL ---
export const ADJUST_BALANCE_SQL = `
  UPDATE games.balances SET amount_minor = amount_minor + $3, updated_at = now()
  WHERE guild_id = $1 AND user_id = $2 AND amount_minor + $3 >= 0`;

export const ENSURE_BALANCE_SQL = `
  INSERT INTO games.balances (guild_id, user_id, amount_minor)
  VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`;

export const LOCK_LISTING_SQL = `
  SELECT listing_id, guild_id, seller_id, instance_id, price_minor, status
  FROM games.listings WHERE listing_id = $1 FOR UPDATE`;

export const LOCK_BALANCE_SQL = `
  SELECT amount_minor FROM games.balances WHERE guild_id = $1 AND user_id = $2 FOR UPDATE`;

export const TRANSFER_INSTANCE_SQL = `
  UPDATE games.card_instances SET owner_user_id = $2
  WHERE instance_id = $1 AND owner_user_id = $3 AND locked = FALSE`;

export const CLOSE_LISTING_SQL = `
  UPDATE games.listings SET status = 'sold' WHERE listing_id = $1 AND status = 'open'`;

export interface DbTx {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
}

export type BuyFailure = "listing-unavailable" | "self-buy" | "insufficient-funds" | "transfer-failed";

// Atomic market buy: locks listing + buyer balance, moves card and funds, closes listing.
// Caller wraps in BEGIN/COMMIT; every mutation is idempotent-safe via the listing's
// single open->sold transition (second buyer finds no open listing).
export async function executeBuy(
  db: DbTx,
  args: { listingId: string; buyerId: string },
): Promise<{ ok: true } | { ok: false; reason: BuyFailure }> {
  const listing = await db.query(LOCK_LISTING_SQL, [args.listingId]);
  const row = listing.rows[0] as
    | { guild_id: string; seller_id: string; instance_id: string; price_minor: number; status: string }
    | undefined;
  if (row == null || row.status !== "open") return { ok: false, reason: "listing-unavailable" };
  if (row.seller_id === args.buyerId) return { ok: false, reason: "self-buy" };

  const balance = await db.query(LOCK_BALANCE_SQL, [row.guild_id, args.buyerId]);
  const funds = (balance.rows[0] as { amount_minor: number } | undefined)?.amount_minor ?? 0;
  if (funds < row.price_minor) return { ok: false, reason: "insufficient-funds" };

  const moved = await db.query(TRANSFER_INSTANCE_SQL, [row.instance_id, args.buyerId, row.seller_id]);
  if (moved.rowCount !== 1) return { ok: false, reason: "transfer-failed" };

  await db.query(ADJUST_BALANCE_SQL, [row.guild_id, args.buyerId, -row.price_minor]);
  await db.query(ADJUST_BALANCE_SQL, [row.guild_id, row.seller_id, row.price_minor]);
  const closed = await db.query(CLOSE_LISTING_SQL, [args.listingId]);
  if (closed.rowCount !== 1) return { ok: false, reason: "listing-unavailable" };
  return { ok: true };
}

export const CREATE_LISTING_SQL = `
  INSERT INTO games.listings (guild_id, seller_id, instance_id, price_minor, idempotency_key)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (idempotency_key) DO NOTHING`;

export const CREATE_TRADE_SQL = `
  INSERT INTO games.trades (guild_id, status, idempotency_key)
  VALUES ($1, 'pending', $2)
  ON CONFLICT (idempotency_key) DO NOTHING`;

export const SET_TRADE_SQL = `
  UPDATE games.trades SET status = $2 WHERE trade_id = $1 AND status = 'pending'`;
