import { createHash, randomInt, randomUUID } from 'node:crypto';
import { lockApprovedGuild, transaction, type SqlClient, type SqlPool } from '@ei-point/flow';

type Actor = { guildId: string; userId: string; key: string };
export type Amount = number | string;
function amount(value: Amount): bigint {
  if ((typeof value === 'number' && !Number.isSafeInteger(value)) || !/^\d{1,16}$/.test(String(value))) throw new Error('invalid-amount');
  const result = BigInt(value);
  if (result > 9007199254740991n) throw new Error('invalid-amount');
  return result;
}
function boundedPage(page: number): number {
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('invalid-page');
  return (page - 1) * 10;
}
async function changed(db: SqlClient, sql: string, args: any[], error = 'mutation-failed'): Promise<void> {
  if ((await db.query(sql, args)).rowCount !== 1) throw new Error(error);
}

export class EconomyService {
  constructor(private readonly pool: SqlPool) {}

  private async operation<T>(actor: Actor, kind: string, input: unknown, run: (db: SqlClient) => Promise<T>): Promise<T> {
    if (!actor.key || actor.key.length > 200) throw new Error('invalid-operation-key');
    const fingerprint = createHash('sha256').update(JSON.stringify({ kind, userId: actor.userId, input })).digest('hex');
    return transaction(this.pool, async db => {
      await lockApprovedGuild(db, actor.guildId);
      const old = (await db.query('SELECT fingerprint,receipt FROM games.operations WHERE guild_id=$1 AND idempotency_key=$2', [actor.guildId, actor.key])).rows[0];
      if (old) {
        if (old.fingerprint !== fingerprint) throw new Error('idempotency-conflict');
        return old.receipt as T;
      }
      const result = await run(db);
      await db.query('INSERT INTO games.operations(guild_id,idempotency_key,fingerprint,receipt) VALUES($1,$2,$3,$4)', [actor.guildId, actor.key, fingerprint, JSON.stringify(result)]);
      return result;
    });
  }
  private async read<T>(guildId: string, run: (db: SqlClient) => Promise<T>): Promise<T> {
    return transaction(this.pool, async db => { await lockApprovedGuild(db, guildId); return run(db); });
  }
  private async adjust(db: SqlClient, actor: Actor, userId: string, delta: bigint): Promise<void> {
    await db.query('INSERT INTO games.balances(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [actor.guildId, userId]);
    await changed(db, `UPDATE games.balances SET amount_minor=amount_minor+$3,updated_at=now()
      WHERE guild_id=$1 AND user_id=$2 AND amount_minor+$3>=0`, [actor.guildId, userId, delta.toString()], 'insufficient-funds');
    await db.query('INSERT INTO games.ledger(guild_id,user_id,delta_minor,operation_key) VALUES($1,$2,$3,$4)', [actor.guildId, userId, delta.toString(), actor.key]);
  }
  async credit(args: Actor & { amount: Amount }): Promise<{ balance: string }> {
    const value = amount(args.amount);
    return this.operation(args, 'credit', value.toString(), async db => {
      await this.adjust(db, args, args.userId, value);
      const row = (await db.query('SELECT amount_minor FROM games.balances WHERE guild_id=$1 AND user_id=$2', [args.guildId, args.userId])).rows[0]!;
      return { balance: String(row.amount_minor) };
    });
  }
  async balance(guildId: string, userId: string): Promise<string> {
    return this.read(guildId, async db => String((await db.query('SELECT amount_minor FROM games.balances WHERE guild_id=$1 AND user_id=$2', [guildId, userId])).rows[0]?.amount_minor ?? 0));
  }
  /** Privileged catalog operations: exposed only through owner-only command dispatch. */
  async defineCard(args: { cardId: string; name: string; rarity: string; artworkRef: string; checksum: string; maxSupply?: number | null }): Promise<void> {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(args.cardId) || !args.name || args.name.length > 200 || !['common','rare','epic','legendary','mythic'].includes(args.rarity) || !/^[a-f0-9]{64}$/.test(args.checksum) || (args.maxSupply != null && (!Number.isSafeInteger(args.maxSupply) || args.maxSupply < 1))) throw new Error('invalid-card');
    if (args.artworkRef && (!args.artworkRef.startsWith('https://') || args.artworkRef.length > 500)) throw new Error('invalid-artwork');
    const saved = await this.pool.query(`INSERT INTO games.card_definitions(card_id,name,rarity,artwork_ref,checksum,max_supply) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(card_id) DO UPDATE SET name=EXCLUDED.name,rarity=EXCLUDED.rarity,artwork_ref=EXCLUDED.artwork_ref,checksum=EXCLUDED.checksum,max_supply=EXCLUDED.max_supply
      WHERE EXCLUDED.max_supply IS NULL OR EXCLUDED.max_supply>=games.card_definitions.issued_count`, [args.cardId, args.name, args.rarity, args.artworkRef, args.checksum, args.maxSupply ?? null]);
    if (saved.rowCount !== 1) throw new Error('invalid-supply');
  }
  private async mint(db: SqlClient, actor: Actor, cardId: string): Promise<{ instanceId: string; cardId: string; serialNumber: string }> {
    const def = await db.query(`UPDATE games.card_definitions SET issued_count=issued_count+1
      WHERE card_id=$1 AND active=true AND (max_supply IS NULL OR issued_count<max_supply) RETURNING issued_count`, [cardId]);
    if (!def.rows[0]) throw new Error('card-exhausted');
    const serialNumber = String(def.rows[0].issued_count);
    const row = (await db.query(`INSERT INTO games.card_instances(card_id,owner_guild_id,owner_user_id,serial_number)
      VALUES($1,$2,$3,$4) RETURNING instance_id`, [cardId, actor.guildId, actor.userId, serialNumber])).rows[0]!;
    return { instanceId: row.instance_id, cardId, serialNumber };
  }
  async issueCard(args: Actor & { cardId: string }): Promise<{ instanceId: string; cardId: string; serialNumber: string }> {
    return this.operation(args, 'issue', args.cardId, db => this.mint(db, args, args.cardId));
  }
  async catalog(guildId: string, page = 1): Promise<Record<string, any>[]> {
    const offset = boundedPage(page);
    return this.read(guildId, async db => (await db.query(`SELECT card_id AS "cardId",name,rarity,artwork_ref AS "artworkRef",max_supply AS "maxSupply",issued_count AS "issuedCount" FROM games.card_definitions WHERE active=true ORDER BY card_id LIMIT 10 OFFSET $1`, [offset])).rows);
  }
  async inventory(guildId: string, userId: string, page = 1): Promise<Record<string, any>[]> {
    const offset = boundedPage(page);
    return this.read(guildId, async db => (await db.query(`SELECT i.instance_id AS "instanceId",i.card_id AS "cardId",i.serial_number AS "serialNumber", i.locked AS reserved,d.name,d.rarity,d.artwork_ref AS "artworkRef"
      FROM games.card_instances i JOIN games.card_definitions d USING(card_id) WHERE owner_guild_id=$1 AND owner_user_id=$2 ORDER BY i.instance_id LIMIT 10 OFFSET $3`, [guildId, userId, offset])).rows);
  }
  async definePack(args: { packId: string; name: string; price: Amount; size: number; adminOnly: boolean; items: { cardId: string; weight: number }[] }): Promise<void> {
    const price = amount(args.price);
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(args.packId) || !args.name || args.name.length > 200 || typeof args.adminOnly !== 'boolean' || !Number.isInteger(args.size) || args.size < 1 || args.size > 10 || !Array.isArray(args.items) || args.items.length < 1 || args.items.length > 100 || new Set(args.items.map(i => i.cardId)).size !== args.items.length || args.items.some(i => !Number.isInteger(i.weight) || i.weight < 1 || i.weight > 1000000)) throw new Error('invalid-pack');
    await transaction(this.pool, async db => {
      await db.query(`INSERT INTO games.packs(pack_id,name,price_minor,size,admin_only) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(pack_id) DO UPDATE SET name=EXCLUDED.name,price_minor=EXCLUDED.price_minor,size=EXCLUDED.size,admin_only=EXCLUDED.admin_only`, [args.packId, args.name, price.toString(), args.size, args.adminOnly]);
      await db.query('DELETE FROM games.pack_items WHERE pack_id=$1', [args.packId]);
      for (const item of args.items) await db.query('INSERT INTO games.pack_items(pack_id,card_id,weight) VALUES($1,$2,$3)', [args.packId, item.cardId, item.weight]);
    });
  }
  async packs(guildId: string): Promise<Record<string, any>[]> {
    return this.read(guildId, async db => (await db.query('SELECT pack_id AS "packId",name,price_minor AS price,size,admin_only AS "adminOnly" FROM games.packs WHERE active=true ORDER BY pack_id LIMIT 25')).rows);
  }
  async openPack(args: Actor & { packId: string; isAdmin: boolean }): Promise<{ cards: { instanceId: string; cardId: string; serialNumber: string }[]; price: string }> {
    return this.operation(args, 'open-pack', { packId: args.packId, isAdmin: args.isAdmin }, async db => {
      const pack = (await db.query('SELECT * FROM games.packs WHERE pack_id=$1 AND active=true FOR SHARE', [args.packId])).rows[0];
      if (!pack) throw new Error('pack-unavailable');
      if (pack.admin_only && !args.isAdmin) throw new Error('admin-required');
      const cards: { instanceId: string; cardId: string; serialNumber: string }[] = [];
      for (let i = 0; i < pack.size; i++) {
        const rows = (await db.query(`SELECT d.card_id,pi.weight FROM games.pack_items pi JOIN games.card_definitions d USING(card_id)
          WHERE pi.pack_id=$1 AND d.active=true AND (d.max_supply IS NULL OR d.issued_count<d.max_supply) ORDER BY d.card_id FOR UPDATE OF d`, [args.packId])).rows;
        if (!rows.length) throw new Error('pack-exhausted');
        let roll = randomInt(rows.reduce((n, row) => n + row.weight, 0));
        const selected = rows.find(row => { roll -= row.weight; return roll < 0; })!;
        cards.push(await this.mint(db, args, selected.card_id));
      }
      await this.adjust(db, args, args.userId, -BigInt(pack.price_minor));
      return { cards, price: String(pack.price_minor) };
    });
  }
  private async reserve(db: SqlClient, actor: Actor, instanceId: string, ref: string, kind: 'listing' | 'trade'): Promise<void> {
    await changed(db, `UPDATE games.card_instances SET locked=true,reservation_id=$4,reservation_type=$5
      WHERE instance_id=$1 AND owner_guild_id=$2 AND owner_user_id=$3 AND locked=false`, [instanceId, actor.guildId, actor.userId, ref, kind], 'card-unavailable');
  }
  async createListing(args: Actor & { instanceId: string; price: Amount }): Promise<{ listingId: string }> {
    const price = amount(args.price); if (price < 1n) throw new Error('invalid-price');
    return this.operation(args, 'list', { instanceId: args.instanceId, price: price.toString() }, async db => {
      const listingId = randomUUID();
      await this.reserve(db, args, args.instanceId, listingId, 'listing');
      await db.query(`INSERT INTO games.listings(listing_id,guild_id,seller_id,instance_id,price_minor,idempotency_key) VALUES($1,$2,$3,$4,$5,$6)`, [listingId, args.guildId, args.userId, args.instanceId, price.toString(), `${args.guildId}:${args.key}`]);
      return { listingId };
    });
  }
  async market(guildId: string, page = 1): Promise<Record<string, any>[]> {
    const offset = boundedPage(page);
    return this.read(guildId, async db => (await db.query(`SELECT l.listing_id AS "listingId",l.seller_id AS "sellerId",l.instance_id AS "instanceId",l.price_minor AS price,l.status,d.name
      FROM games.listings l JOIN games.card_instances i USING(instance_id) JOIN games.card_definitions d USING(card_id) WHERE l.guild_id=$1 AND l.status='open' ORDER BY l.created_at,l.listing_id LIMIT 10 OFFSET $2`, [guildId, offset])).rows);
  }
  async buy(args: Actor & { listingId: string }): Promise<{ listingId: string; instanceId: string; price: string }> {
    return this.operation(args, 'buy', args.listingId, async db => {
      const row = (await db.query(`SELECT * FROM games.listings WHERE guild_id=$1 AND listing_id=$2 AND status='open' FOR UPDATE`, [args.guildId, args.listingId])).rows[0];
      if (!row) throw new Error('listing-unavailable');
      if (row.seller_id === args.userId) throw new Error('self-buy');
      await changed(db, `UPDATE games.card_instances SET owner_user_id=$4,locked=false,reservation_id=NULL,reservation_type=NULL
        WHERE instance_id=$1 AND owner_guild_id=$2 AND owner_user_id=$3 AND reservation_id=$5 AND reservation_type='listing'`, [row.instance_id, args.guildId, row.seller_id, args.userId, args.listingId], 'card-unavailable');
      await this.adjust(db, args, args.userId, -BigInt(row.price_minor));
      await this.adjust(db, args, row.seller_id, BigInt(row.price_minor));
      await changed(db, "UPDATE games.listings SET status='sold' WHERE listing_id=$1 AND status='open'", [args.listingId]);
      return { listingId: args.listingId, instanceId: row.instance_id, price: String(row.price_minor) };
    });
  }
  async cancelListing(args: Actor & { listingId: string }): Promise<{ status: string }> {
    return this.operation(args, 'cancel-listing', args.listingId, async db => {
      await changed(db, "UPDATE games.listings SET status='cancelled' WHERE listing_id=$1 AND guild_id=$2 AND seller_id=$3 AND status='open'", [args.listingId, args.guildId, args.userId], 'listing-unavailable');
      await db.query("UPDATE games.card_instances SET locked=false,reservation_id=NULL,reservation_type=NULL WHERE owner_guild_id=$1 AND reservation_id=$2 AND reservation_type='listing'", [args.guildId, args.listingId]);
      return { status: 'cancelled' };
    });
  }
  async offerTrade(args: Actor & { recipientId: string; offered: string[]; requested: string[]; offeredAmount: Amount; requestedAmount: Amount; ttlMinutes: number }): Promise<{ tradeId: string }> {
    const offeredAmount = amount(args.offeredAmount), requestedAmount = amount(args.requestedAmount);
    const items = [...args.offered, ...args.requested];
    if (args.recipientId === args.userId || items.length > 20 || new Set(items).size !== items.length || (!items.length && offeredAmount === 0n && requestedAmount === 0n) || !Number.isInteger(args.ttlMinutes) || args.ttlMinutes < 1 || args.ttlMinutes > 10080) throw new Error('invalid-trade');
    return this.operation(args, 'offer-trade', { recipientId: args.recipientId, offered: args.offered, requested: args.requested, offeredAmount: offeredAmount.toString(), requestedAmount: requestedAmount.toString(), ttlMinutes: args.ttlMinutes }, async db => {
      const tradeId = randomUUID();
      if ((await db.query("SELECT count(*)::int AS count FROM games.trades WHERE guild_id=$1 AND sender_id=$2 AND status='pending'", [args.guildId, args.userId])).rows[0]!.count >= 20) throw new Error('trade-limit');
      for (const id of args.offered) await this.reserve(db, args, id, tradeId, 'trade');
      for (const id of args.requested) {
        const r = await db.query('SELECT 1 FROM games.card_instances WHERE instance_id=$1 AND owner_guild_id=$2 AND owner_user_id=$3 AND locked=false', [id, args.guildId, args.recipientId]);
        if (!r.rowCount) throw new Error('card-unavailable');
      }
      await db.query(`INSERT INTO games.trades(trade_id,guild_id,idempotency_key,sender_id,recipient_id,offered_amount,requested_amount,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,now()+make_interval(mins=>$8))`, [tradeId, args.guildId, `${args.guildId}:${args.key}`, args.userId, args.recipientId, offeredAmount.toString(), requestedAmount.toString(), args.ttlMinutes]);
      for (const [side, ids] of [['offered', args.offered], ['requested', args.requested]] as const) for (const id of ids) await db.query('INSERT INTO games.trade_items(trade_id,instance_id,side) VALUES($1,$2,$3)', [tradeId, id, side]);
      return { tradeId };
    });
  }
  async acceptTrade(args: Actor & { tradeId: string }): Promise<{ status: string }> {
    return this.operation(args, 'accept-trade', args.tradeId, async db => {
      const row = (await db.query("SELECT * FROM games.trades WHERE guild_id=$1 AND trade_id=$2 AND status='pending' AND expires_at>now() FOR UPDATE", [args.guildId, args.tradeId])).rows[0];
      if (!row) throw new Error('trade-unavailable');
      if (row.recipient_id !== args.userId) throw new Error('recipient-required');
      const items = (await db.query('SELECT instance_id,side FROM games.trade_items WHERE trade_id=$1 ORDER BY instance_id', [args.tradeId])).rows;
      if (items.length) {
        const itemIds = items.map((i: any) => i.instance_id);
        const lockedCards = (await db.query('SELECT instance_id FROM games.card_instances WHERE instance_id = ANY($1) ORDER BY instance_id FOR UPDATE', [itemIds])).rows;
        if (lockedCards.length !== itemIds.length) throw new Error('card-unavailable');
      }
      for (const item of items) {
        const offered = item.side === 'offered';
        await changed(db, `UPDATE games.card_instances SET owner_user_id=$4,locked=false,reservation_id=NULL,reservation_type=NULL
          WHERE instance_id=$1 AND owner_guild_id=$2 AND owner_user_id=$3 AND
          (($5::boolean AND reservation_id=$6 AND reservation_type='trade') OR (NOT $5::boolean AND locked=false))`, [item.instance_id, args.guildId, offered ? row.sender_id : row.recipient_id, offered ? row.recipient_id : row.sender_id, offered, args.tradeId], 'card-unavailable');
      }
      // Each side must afford its gross payment; no credit-before-debit overdraft trick.
      await this.adjust(db, args, row.sender_id, -BigInt(row.offered_amount));
      await this.adjust(db, args, row.recipient_id, -BigInt(row.requested_amount));
      await this.adjust(db, args, row.sender_id, BigInt(row.requested_amount));
      await this.adjust(db, args, row.recipient_id, BigInt(row.offered_amount));
      await changed(db, "UPDATE games.trades SET status='done' WHERE trade_id=$1 AND status='pending'", [args.tradeId]);
      return { status: 'done' };
    });
  }
  async cancelTrade(args: Actor & { tradeId: string }): Promise<{ status: string }> {
    return this.operation(args, 'cancel-trade', args.tradeId, async db => {
      await changed(db, "UPDATE games.trades SET status='cancelled' WHERE trade_id=$1 AND guild_id=$2 AND (sender_id=$3 OR recipient_id=$3) AND status='pending'", [args.tradeId, args.guildId, args.userId], 'trade-unavailable');
      await this.releaseTrade(db, args.guildId, args.tradeId);
      return { status: 'cancelled' };
    });
  }
  private async releaseTrade(db: SqlClient, guildId: string, tradeId: string): Promise<void> {
    await db.query("UPDATE games.card_instances SET locked=false,reservation_id=NULL,reservation_type=NULL WHERE owner_guild_id=$1 AND reservation_id=$2 AND reservation_type='trade'", [guildId, tradeId]);
  }
  async expireTrades(guildId: string): Promise<number> {
    return this.read(guildId, async db => {
      const rows = (await db.query("UPDATE games.trades SET status='expired' WHERE guild_id=$1 AND status='pending' AND expires_at<=now() RETURNING trade_id", [guildId])).rows;
      for (const row of rows) await this.releaseTrade(db, guildId, row.trade_id);
      return rows.length;
    });
  }
  async trades(guildId: string, userId: string, page = 1): Promise<Record<string, any>[]> {
    const offset = boundedPage(page);
    return this.read(guildId, async db => (await db.query(`SELECT trade_id AS "tradeId",sender_id AS "senderId",recipient_id AS "recipientId",status,offered_amount AS "offeredAmount",requested_amount AS "requestedAmount",expires_at AS "expiresAt"
      FROM games.trades WHERE guild_id=$1 AND (sender_id=$2 OR recipient_id=$2) ORDER BY created_at DESC,trade_id LIMIT 10 OFFSET $3`, [guildId, userId, offset])).rows);
  }
}
