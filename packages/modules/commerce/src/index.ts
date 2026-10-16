// Commerce module: catalog, UPI/USDT QR, orders, claims, settlement, referrals
// (§2 commerce bot, §4 commerce.*). Server owns prices; browser never chooses
// amounts or discounts. Double-claim/double-settlement safety via UNIQUE + locks.

import { createHash, randomBytes } from "node:crypto";

// --- Money: integer minor units, always > 0. ---
export function validAmountMinor(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0;
}

// --- Order verification tokens: public token, hashed storage. ---
export function newOrderToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// --- UPI QR payload (upi://pay). Amount in minor units -> major with 2 decimals. ---
const VPA_RE = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/;

export function buildUpiPayload(args: {
  payeeVpa: string;
  payeeName: string;
  amountMinor: number;
  note: string;
}): string | null {
  if (!VPA_RE.test(args.payeeVpa)) return null;
  if (!validAmountMinor(args.amountMinor)) return null;
  if (args.payeeName.length === 0 || args.note.length === 0) return null;
  const params = new URLSearchParams({
    pa: args.payeeVpa,
    pn: args.payeeName,
    am: (args.amountMinor / 100).toFixed(2),
    cu: "INR",
    tn: args.note.slice(0, 80),
  });
  return `upi://pay?${params.toString()}`;
}

// --- USDT addresses: TRON base58 or ERC20 hex. ---
export type UsdtNetwork = "tron" | "erc20";

export function validateUsdtAddress(address: string): UsdtNetwork | null {
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return "tron";
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return "erc20";
  return null;
}

// --- Order state machine. ---
export type OrderStatus = "pending" | "claimed" | "settled" | "rejected" | "expired";

const ORDER_FLOW: Record<OrderStatus, OrderStatus[]> = {
  pending: ["claimed", "rejected", "expired"],
  claimed: ["settled", "rejected"],
  settled: [],
  rejected: [],
  expired: [],
};

export function orderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_FLOW[from].includes(to);
}

// --- Referral cycles: YYYY-MM; rewards expire at month boundary unless paid. ---
export function cycleFor(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isRewardExpired(rewardCycle: string, nowCycle: string, status: string): boolean {
  return status === "reserved" && rewardCycle < nowCycle;
}

export function newReferralCode(prefix: string): string {
  const clean = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "EI";
  return `${clean}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

// --- SQL ---
export const CREATE_ORDER_SQL = `
  INSERT INTO commerce.orders (guild_id, buyer_id, sku, amount_minor, order_token_hash, idempotency_key)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (idempotency_key) DO NOTHING`;

export const LOCK_ORDER_SQL = `
  SELECT * FROM commerce.orders WHERE order_id = $1 AND guild_id=$2 AND ($3::text IS NULL OR buyer_id=$3) FOR UPDATE`;

export const CREATE_CLAIM_SQL = `
  INSERT INTO commerce.claims (order_id, proof_ref, idempotency_key)
  VALUES ($1, $2, $3)
  ON CONFLICT (idempotency_key) DO NOTHING`;

export const MARK_CLAIMED_SQL = `
  UPDATE commerce.orders SET status = 'claimed' WHERE order_id = $1 AND status = 'pending'`;

export const CREATE_SETTLEMENT_SQL = `
  INSERT INTO commerce.settlements (order_id, settled_by, idempotency_key)
  VALUES ($1, $2, $3)
  ON CONFLICT (idempotency_key) DO NOTHING`;

export const MARK_SETTLED_SQL = `
  UPDATE commerce.orders SET status = 'settled' WHERE order_id = $1 AND status = 'claimed'`;

export const VERIFY_ORDER_SQL = `
  SELECT o.status, o.amount_minor, c.name AS sku_name
  FROM commerce.orders o JOIN commerce.catalog c ON c.sku = o.sku
  WHERE o.order_token_hash = $1`;

export const EXPIRE_REWARDS_SQL = `
  UPDATE commerce.rewards SET status = 'expired'
  WHERE status = 'reserved' AND cycle < $1`;

export interface DbTx {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
}

export type ClaimFailure = "not-pending" | "already-claimed" | "invalid-proof" | "expired";
export type SettleFailure = "not-claimable" | "already-settled";

// Claim: pending -> claimed, exactly once per order (UNIQUE claims.order_id +
// status-guarded update; the second claimant finds no pending order).
export async function executeClaim(
  db: DbTx,
  args: { orderId: string; proofRef: string; idempotencyKey: string; guildId: string; buyerId: string },
): Promise<{ ok: true } | { ok: false; reason: ClaimFailure }> {
  const found = await db.query(LOCK_ORDER_SQL, [args.orderId, args.guildId ?? null, "buyerId" in args ? args.buyerId ?? null : null]);
  const status = (found.rows[0] as { status: string } | undefined)?.status;
  if (status == null || (status !== "pending" && status !== "claimed")) {
    return { ok: false, reason: "not-pending" };
  }
  const order=found.rows[0]!;
  const method=order.method === "usdt" ? "usdt" : order.method === "razorpay" ? "razorpay" : "upi";
  const raw=args.proofRef.replace(new RegExp(`^${method}:`),"");
  if(!(method==="usdt"?/^[a-fA-F0-9]{64}$/:method==="razorpay"?/^[A-Za-z0-9_-]{6,64}$/:/^\d{12}$/).test(raw))return {ok:false,reason:"invalid-proof"};
  const proofRef=`${method}:${method==="razorpay"?raw:raw.toLowerCase()}`;
  if (status === "claimed") {
    const claim=(await db.query("SELECT proof_ref FROM commerce.claims WHERE order_id=$1",[args.orderId])).rows[0];
    return claim?.proof_ref===proofRef?{ok:true}:{ok:false,reason:"already-claimed"};
  }
  if(order.expires_at && new Date(String(order.expires_at)).getTime()<Date.now())return {ok:false,reason:"expired"};
  await db.query(CREATE_CLAIM_SQL, [args.orderId, proofRef, args.idempotencyKey]);
  const marked = await db.query(MARK_CLAIMED_SQL, [args.orderId]);
  if (marked.rowCount !== 1) return { ok: false, reason: "already-claimed" };
  return { ok: true };
}

// Settlement: claimed -> settled, exactly once (UNIQUE settlements.order_id +
// status-guarded update; concurrent settlers serialize on the row lock).
export async function executeSettle(
  db: DbTx,
  args: { orderId: string; settledBy: string; idempotencyKey: string; guildId: string; referralRewardMinor?: number },
): Promise<{ ok: true } | { ok: false; reason: SettleFailure }> {
  const found = await db.query(LOCK_ORDER_SQL, [args.orderId, args.guildId ?? null, "buyerId" in args ? args.buyerId ?? null : null]);
  const status = (found.rows[0] as { status: string } | undefined)?.status;
  if (status == null || (status !== "claimed" && status !== "settled")) {
    return { ok: false, reason: "not-claimable" };
  }
  if (status === "settled") return { ok: false, reason: "already-settled" };
  await db.query(CREATE_SETTLEMENT_SQL, [args.orderId, args.settledBy, args.idempotencyKey]);
  const marked = await db.query(MARK_SETTLED_SQL, [args.orderId]);
  if (marked.rowCount !== 1) return { ok: false, reason: "already-settled" };
  await fulfillOrder(async(sql, params) => (await db.query(sql, params ?? [])).rows, found.rows[0]!, args.referralRewardMinor ?? 0);
  return { ok: true };
}

export type RejectFailure = "not-rejectable" | "already-rejected";

export const REJECT_ORDER_SQL = `
  UPDATE commerce.orders SET status = 'rejected' WHERE order_id = $1 AND status IN ('pending', 'claimed')`;

export const REJECT_CLAIMS_SQL = `
  UPDATE commerce.claims SET status = 'rejected' WHERE order_id = $1`;

// Rejection: pending|claimed -> rejected (staff decision). Mirrors executeSettle:
// row lock, status-guarded update, 0 rows touched -> already-rejected.
export async function executeReject(
  db: DbTx,
  args: { orderId: string; guildId: string },
): Promise<{ ok: true } | { ok: false; reason: RejectFailure }> {
  const found = await db.query(LOCK_ORDER_SQL, [args.orderId, args.guildId ?? null, null]);
  const status = (found.rows[0] as { status: string } | undefined)?.status;
  if (status == null || (status !== "pending" && status !== "claimed")) {
    return { ok: false, reason: status === "rejected" ? "already-rejected" : "not-rejectable" };
  }
  const marked = await db.query(REJECT_ORDER_SQL, [args.orderId]);
  if (marked.rowCount !== 1) return { ok: false, reason: "already-rejected" };
  await db.query(REJECT_CLAIMS_SQL, [args.orderId]);
  return { ok: true };
}

// Called only while holding the order row lock, in the settlement transaction.
export async function fulfillOrder(q:(sql:string,params?:unknown[])=>Promise<Record<string,any>[]>,o:Record<string,any>,reward:number):Promise<void>{
 const guild=o.guild_id,cycle=cycleFor(new Date());
 if(Number(o.membership_days)>0)await q(`INSERT INTO commerce.memberships(guild_id,user_id,expires_at) VALUES($1,$2,now()+$3*interval '1 day') ON CONFLICT(guild_id,user_id) DO UPDATE SET expires_at=greatest(commerce.memberships.expires_at,now())+$3*interval '1 day',updated_at=now()`,[guild,o.buyer_id,o.membership_days]);
 await q("UPDATE commerce.rewards SET status='expired' WHERE guild_id=$1 AND status='reserved' AND cycle<$2",[guild,cycle]);
 if(o.referral_code){const r=(await q("UPDATE commerce.referrals SET uses=uses+1 WHERE code=$1 AND guild_id=$2 AND cycle=$3 RETURNING referrer_id",[o.referral_code,guild,cycle]))[0];if(r&&Number.isSafeInteger(reward)&&reward>0)await q("INSERT INTO commerce.rewards(guild_id,user_id,cycle,amount_minor,idempotency_key) VALUES($1,$2,$3,$4,$5)",[guild,r.referrer_id,cycle,reward,`checkout:${o.order_id}`]);}
 await q("UPDATE commerce.claims SET status='confirmed' WHERE order_id=$1",[o.order_id]);
}
