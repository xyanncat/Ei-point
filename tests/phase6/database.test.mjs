import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from '../helpers/embedded-postgres.mjs';
import * as games from '../../packages/modules/games/dist/index.js';
import * as community from '../../packages/modules/community/dist/index.js';

let server, pool;
const guild = '100000000000000001', alice = '200000000000000001', bob = '200000000000000002', eve = '200000000000000003';
before(async () => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const databaseDir = await mkdtemp(join(tmpdir(), 'ei-phase6-'));
  server = new EmbeddedPostgres({ databaseDir, port, user: 'postgres', password: 'isolated-test-only', persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'isolated-test-only', database: 'postgres', max: 5 });
  const dir = new URL('../../infra/postgres/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(name, dir), 'utf8'));
}, { timeout: 120000 });
after(async () => { await pool?.end(); await server?.stop(); });
beforeEach(async () => {
  assert.equal(typeof games.EconomyService, 'function', 'Phase 6 must provide a real transaction service');
  assert.equal(typeof community.CommunityService, 'function', 'Phase 6 must persist community events');
  await pool.query(`TRUNCATE games.operations, games.card_games, games.trade_items, games.trades, games.listings, games.pack_items, games.packs, games.card_instances, games.card_definitions, games.balances, games.ledger, community.xp_events, community.xp, community.welcome_templates, ops.outbox CASCADE`);
  await pool.query(`INSERT INTO access.guilds(guild_id,name,owner_id,approved) VALUES ($1,'Test', $2,true) ON CONFLICT(guild_id) DO UPDATE SET approved=true`, [guild, alice]);
});
const economy = () => new games.EconomyService(pool);
const members = () => new community.CommunityService(pool);
/** Migration 015 makes Himiko the sole community outbox consumer; register the test guild for it. */
async function registerDeliveryGuild() {
  await pool.query(`UPDATE config.bots SET guild_ids = ARRAY[$1::text] WHERE bot_key = 'himiko'`, [guild]);
}
async function catalog(supply = null) {
  await economy().defineCard({ cardId: 'test-card', name: 'Test card', rarity: 'common', artworkRef: '', checksum: 'a'.repeat(64), maxSupply: supply });
}
async function issue(userId = alice, key = 'issue', supply = null) {
  await catalog(supply);
  return economy().issueCard({ guildId: guild, userId, cardId: 'test-card', key });
}
async function fund(userId, amount, key = `fund-${userId}`) { return economy().credit({ guildId: guild, userId, amount, key }); }
test('concurrent XP events obey cooldown; duplicate delivery never awards twice', async () => {
  await members().configure(guild, { xpEnabled: true, xpPerMessage: 15, cooldownSeconds: 60 });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => members().awardXp({ guildId: guild, userId: alice, messageId: `msg-${i}` })));
  assert.equal(results.filter(r => r.awarded).length, 1);
  assert.equal((await members().rank(guild, alice)).xp, '15');
  await members().awardXp({ guildId: guild, userId: alice, messageId: 'msg-0' });
  assert.equal((await members().rank(guild, alice)).xp, '15');
});
test('welcome and leave templates persist and deduplicate durable notifications', async () => {
  await members().configure(guild, { welcomeChannelId: alice, welcomeTemplate: 'Hello {user} in {guild} #{count}', leaveChannelId: bob, leaveTemplate: 'Bye {user}' });
  const input = { guildId: guild, userId: alice, guildName: 'Paradise', memberCount: 42, event: 'join', key: 'join-1' };
  await Promise.all([members().memberEvent(input), members().memberEvent(input)]);
  const events = await pool.query(`SELECT payload FROM ops.outbox WHERE type='community.message'`);
  assert.equal(events.rowCount, 1);
  assert.equal(events.rows[0].payload.content, `Hello <@${alice}> in Paradise #42`);
});
test('listing purchase has exactly one concurrent winner and conserves funds', async () => {
  const card = await issue(); await fund(bob, 500); await fund(eve, 500);
  const listing = await economy().createListing({ guildId: guild, userId: alice, instanceId: card.instanceId, price: 100, key: 'list' });
  const results = await Promise.allSettled([bob, eve].map(userId => economy().buy({ guildId: guild, userId, listingId: listing.listingId, key: `buy-${userId}` })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const totals = await pool.query('SELECT sum(amount_minor)::text AS total FROM games.balances');
  assert.equal(totals.rows[0].total, '1000');
  assert.equal((await economy().balance(guild, alice)), '100');
});
test('idempotent purchase retries return receipt without charging again', async () => {
  const card = await issue(); await fund(bob, 300);
  const listing = await economy().createListing({ guildId: guild, userId: alice, instanceId: card.instanceId, price: 100, key: 'list' });
  const args = { guildId: guild, userId: bob, listingId: listing.listingId, key: 'buy' };
  assert.deepEqual(await economy().buy(args), await economy().buy(args));
  assert.equal(await economy().balance(guild, bob), '200');
  await assert.rejects(economy().credit({ guildId: guild, userId: bob, amount: 1, key: 'buy' }), /idempotency-conflict/);
});
test('failure after card movement rolls back ownership, balances and listing', async () => {
  const card = await issue(); await fund(bob, 300);
  const listing = await economy().createListing({ guildId: guild, userId: alice, instanceId: card.instanceId, price: 100, key: 'list' });
  // A real database trigger fails the final mutation, after the transfer/debits.
  await pool.query(`CREATE FUNCTION games.test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected-failure'; END $$; CREATE TRIGGER test_fail BEFORE UPDATE ON games.listings FOR EACH ROW EXECUTE FUNCTION games.test_fail()`);
  try {
    await assert.rejects(economy().buy({ guildId: guild, userId: bob, listingId: listing.listingId, key: 'buy' }), /injected-failure/);
    assert.equal(await economy().balance(guild, bob), '300');
    assert.equal((await economy().inventory(guild, alice))[0].instanceId, card.instanceId);
    assert.equal((await economy().market(guild))[0].status, 'open');
  } finally { await pool.query('DROP TRIGGER test_fail ON games.listings; DROP FUNCTION games.test_fail()'); }
});
test('reserved cards cannot be listed or offered twice; cancellation releases them', async () => {
  const card = await issue();
  const args = { guildId: guild, userId: alice, instanceId: card.instanceId, price: 20, key: 'list' };
  const list = await economy().createListing(args);
  await assert.rejects(economy().createListing({ ...args, key: 'list-again' }), /card-unavailable/);
  await assert.rejects(economy().offerTrade({ guildId: guild, userId: alice, recipientId: bob, offered: [card.instanceId], requested: [], offeredAmount: 0, requestedAmount: 0, ttlMinutes: 60, key: 'offer' }), /card-unavailable/);
  await economy().cancelListing({ guildId: guild, userId: alice, listingId: list.listingId, key: 'cancel' });
  await economy().createListing({ ...args, key: 'list-new' });
});
test('concurrent trade acceptance settles once with atomic card and currency exchange', async () => {
  const a = await issue(alice, 'a'); const b = await issue(bob, 'b'); await fund(alice, 500); await fund(bob, 300);
  const trade = await economy().offerTrade({ guildId: guild, userId: alice, recipientId: bob, offered: [a.instanceId], requested: [b.instanceId], offeredAmount: 100, requestedAmount: 50, ttlMinutes: 60, key: 'offer' });
  const results = await Promise.allSettled([1, 2].map(i => economy().acceptTrade({ guildId: guild, userId: bob, tradeId: trade.tradeId, key: `accept-${i}` })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await economy().balance(guild, alice), '450'); assert.equal(await economy().balance(guild, bob), '350');
  assert.equal((await economy().inventory(guild, alice))[0].instanceId, b.instanceId);
  assert.equal((await economy().inventory(guild, bob))[0].instanceId, a.instanceId);
});
test('insufficient trade funds leave offered cards and trade pending', async () => {
  const card = await issue();
  const trade = await economy().offerTrade({ guildId: guild, userId: alice, recipientId: bob, offered: [card.instanceId], requested: [], offeredAmount: 0, requestedAmount: 100, ttlMinutes: 60, key: 'offer' });
  await assert.rejects(economy().acceptTrade({ guildId: guild, userId: bob, tradeId: trade.tradeId, key: 'accept' }), /insufficient-funds/);
  assert.equal((await economy().trades(guild, alice))[0].status, 'pending');
  assert.equal((await economy().inventory(guild, alice))[0].reserved, true);
});
test('expired trades release reservations and cannot be accepted', async () => {
  const card = await issue();
  const trade = await economy().offerTrade({ guildId: guild, userId: alice, recipientId: bob, offered: [card.instanceId], requested: [], offeredAmount: 0, requestedAmount: 0, ttlMinutes: 1, key: 'offer' });
  await pool.query(`UPDATE games.trades SET expires_at=now()-interval '1 second' WHERE trade_id=$1`, [trade.tradeId]);
  await economy().expireTrades(guild);
  await assert.rejects(economy().acceptTrade({ guildId: guild, userId: bob, tradeId: trade.tradeId, key: 'accept' }), /trade-unavailable/);
  assert.equal((await economy().inventory(guild, alice))[0].reserved, false);
});
test('pack opening is priced by server, idempotent and enforces finite supply', async () => {
  await catalog(2); await fund(alice, 100);
  await economy().definePack({ packId: 'starter', name: 'Starter', price: 10, size: 1, adminOnly: false, items: [{ cardId: 'test-card', weight: 1 }] });
  const args = { guildId: guild, userId: alice, packId: 'starter', key: 'open', isAdmin: false };
  assert.deepEqual(await economy().openPack(args), await economy().openPack(args));
  await economy().openPack({ ...args, key: 'open-2' });
  await assert.rejects(economy().openPack({ ...args, key: 'open-3' }), /pack-exhausted/);
  assert.equal(await economy().balance(guild, alice), '80');
  assert.equal((await economy().inventory(guild, alice)).length, 2);
});
test('premium pack and guild boundaries fail closed', async () => {
  await catalog();
  await economy().definePack({ packId: 'premium', name: 'Premium', price: 0, size: 1, adminOnly: true, items: [{ cardId: 'test-card', weight: 1 }] });
  await assert.rejects(economy().openPack({ guildId: guild, userId: bob, packId: 'premium', key: 'open', isAdmin: false }), /admin-required/);
  await pool.query('UPDATE access.guilds SET approved=false WHERE guild_id=$1', [guild]);
  await assert.rejects(economy().credit({ guildId: guild, userId: alice, amount: 1, key: 'fund' }), /guild-not-approved/);
});
test('finite supply issuance under concurrency never duplicates serials', async () => {
  await catalog(2);
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => economy().issueCard({ guildId: guild, userId: alice, cardId: 'test-card', key: `issue-${i}` })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  const rows = await pool.query('SELECT serial_number FROM games.card_instances ORDER BY serial_number');
  assert.deepEqual(rows.rows.map(r => r.serial_number), ['1', '2']);
});
test('card inspection stays within the guild and the legacy five-card game persists concurrent rounds', async () => {
  const issued = await issue(alice, 'legacy-card');
  const details = await economy().cardInfo(guild, issued.instanceId);
  assert.equal(details.cardId, 'test-card');
  assert.equal(details.ownerUserId, alice);
  assert.equal(details.serialNumber, '1');
  const otherGuild = '100000000000000099';
  await pool.query(`INSERT INTO access.guilds(guild_id,name,owner_id,approved) VALUES ($1,'Other',$2,true) ON CONFLICT(guild_id) DO UPDATE SET approved=true`, [otherGuild, bob]);
  assert.equal(await economy().cardInfo(otherGuild, issued.instanceId), null);
  assert.deepEqual(await economy().cardStats(guild, alice), {
    total: 1, unique: 1, byRarity: { common: 1 },
  });
  await economy().revokeCard({ guildId: guild, userId: alice, key: 'revoke-card', instanceId: issued.instanceId });
  assert.equal((await economy().cardInfo(guild, issued.instanceId)).status, 'revoked');
  assert.deepEqual(await economy().cardStats(guild, alice), { total: 0, unique: 0, byRarity: {} });
  await assert.rejects(economy().createListing({ guildId: guild, userId: alice, key: 'list-revoked', instanceId: issued.instanceId, price: 10 }), /card-unavailable/);
  const initial = await economy().cardGame(guild, alice);
  assert.equal(initial.deck.length, 52);
  assert.equal(new Set(initial.deck).size, 52);
  const rounds = await Promise.all([
    economy().playCardRound({ guildId: guild, userId: alice, key: 'round-1' }),
    economy().playCardRound({ guildId: guild, userId: alice, key: 'round-2' }),
  ]);
  assert.equal(rounds.length, 2);
  const final = await economy().cardGame(guild, alice);
  assert.equal(final.gamesPlayed, '2');
  assert.equal(final.deck.length, 32);
  assert.equal(final.hand.length, 5);
  assert.ok(['win', 'loss', 'push'].includes(rounds[0].outcome));
  assert.deepEqual(rounds[0], await economy().playCardRound({ guildId: guild, userId: alice, key: 'round-1' }));
  assert.equal((await economy().cardGame(guild, alice)).gamesPlayed, '2');
});
test('rank returns the correct position and successful level-up is durable', async () => {
  await members().configure(guild, { xpPerMessage: 100, levelChannelId: bob });
  await members().awardXp({ guildId: guild, userId: alice, messageId: 'a' });
  assert.deepEqual(await members().rank(guild, alice), { xp: '100', level: 1, rank: 1 });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ops.outbox WHERE type='community.message'")).rows[0].n, 1);
});
test('cross-guild purchase and unauthorized trade accept cannot mutate cards', async () => {
  const card = await issue();
  const trade = await economy().offerTrade({ guildId: guild, userId: alice, recipientId: bob, offered: [card.instanceId], requested: [], offeredAmount: 0, requestedAmount: 0, ttlMinutes: 60, key: 'offer' });
  await assert.rejects(economy().acceptTrade({ guildId: guild, userId: eve, tradeId: trade.tradeId, key: 'wrong' }), /recipient-required/);
  assert.equal((await economy().inventory(guild, alice))[0].reserved, true);
  await economy().cancelTrade({ guildId: guild, userId: bob, tradeId: trade.tradeId, key: 'cancel' });
  assert.equal((await economy().inventory(guild, alice))[0].reserved, false);
  const otherGuild = '999999999999999999';
  await pool.query("INSERT INTO access.guilds(guild_id,name,owner_id,approved) VALUES($1,'Other test guild',$2,true)", [otherGuild, alice]);
  const listing = await economy().createListing({ guildId: guild, userId: alice, instanceId: card.instanceId, price: 10, key: 'list-boundary' });
  await economy().credit({ guildId: otherGuild, userId: bob, amount: 100, key: 'other-credit' });
  await assert.rejects(economy().buy({ guildId: otherGuild, userId: bob, listingId: listing.listingId, key: 'other-buy' }), /listing-unavailable/);
  assert.equal(await economy().balance(otherGuild, bob), '100');
  assert.equal((await economy().inventory(guild, alice))[0].instanceId, card.instanceId);
});
test('Discord command dispatch acknowledges before work and restricts admin commands', async () => {
  const bot = await import('../../apps/bots/community/dist/commands.js').catch(() => ({}));
  assert.equal(typeof bot.respondToCommand, 'function', 'Phase 6 needs a usable Discord command handler');
  const registered = new Set(bot.commandDefinitions.map(command => command.toJSON().name));
  for (const name of ['cardinfo', 'cardstats', 'play', 'deck', 'hand', 'score']) assert.ok(registered.has(name), `community bot must register legacy ${name}`);
  const messages = [], order = [];
  const context = { guildId: guild, userId: bob, key: 'command', isOwner: false, canManage: false, defer: async () => order.push('ack'), reply: async text => messages.push(text) };
  await bot.respondToCommand({ ...context, name: 'rank', options: {} }, { community: members(), economy: economy() });
  assert.equal(order[0], 'ack'); assert.match(messages[0], /XP/);
  await bot.respondToCommand({ ...context, name: 'cardadmin', subcommand: 'credit', options: { amount: 100, user: bob } }, { community: members(), economy: economy() });
  assert.match(messages[1], /owner/i);
  assert.equal(await economy().balance(guild, bob), '0');
  const actor = { ...context, userId: alice, isOwner: true, canManage: true };
  await bot.respondToCommand({ ...actor, key: 'play-idempotent', name: 'play', options: {} }, { community: members(), economy: economy() });
  const firstPlay = messages.at(-1);
  await bot.respondToCommand({ ...actor, key: 'play-idempotent', name: 'play', options: {} }, { community: members(), economy: economy() });
  assert.equal(messages.at(-1), firstPlay);
  assert.equal((await economy().cardGame(guild, alice)).gamesPlayed, '1');
  await bot.respondToCommand({ ...actor, name: 'hand', key: 'hand', options: {} }, { community: members(), economy: economy() });
  assert.match(messages.at(-1), /Last hand/);
  await bot.respondToCommand({ ...actor, name: 'score', key: 'score', options: {} }, { community: members(), economy: economy() });
  assert.match(messages.at(-1), /Rounds: 1/);
});
test('sell cancel is reachable, owner-scoped and race-safe against a concurrent buy', async () => {
  const bot = await import('../../apps/bots/community/dist/commands.js').catch(() => ({}));
  const registered = new Set(bot.commandDefinitions.map(command => command.toJSON().name));
  assert.ok(registered.has('sell'), 'sell must stay registered');
  assert.ok(!registered.has('unlist'), 'unlist must remain unregistered');
  const messages = [];
  const reply = async text => messages.push(text);
  const context = { guildId: guild, userId: alice, key: 'cancel-1', isOwner: false, canManage: false, defer: async () => {}, reply };
  // The owner cancels their own listing through /sell cancel.
  const card = await issue();
  const listing = await economy().createListing({ guildId: guild, userId: alice, instanceId: card.instanceId, price: 25, key: 'cancel-reach' });
  await bot.respondToCommand({ ...context, name: 'sell', options: { cancel: listing.listingId } }, { community: members(), economy: economy() });
  assert.match(messages.at(-1), /cancelled/i);
  assert.equal((await economy().market(guild)).length, 0);
  assert.equal((await economy().inventory(guild, alice))[0].reserved, false);
  // Non-owner and repeated cancels fail without touching the listing.
  await economy().credit({ guildId: guild, userId: alice, amount: 10, key: 'seller-credit' });
  const card2 = await economy().issueCard({ guildId: guild, userId: alice, cardId: 'test-card', key: 'issue-2' });
  const listing2 = await economy().createListing({ guildId: guild, userId: alice, instanceId: card2.instanceId, price: 30, key: 'cancel-guard' });
  await bot.respondToCommand({ ...context, userId: bob, key: 'cancel-2', name: 'sell', options: { cancel: listing2.listingId } }, { community: members(), economy: economy() });
  assert.doesNotMatch(messages.at(-1), /cancelled/i);
  await bot.respondToCommand({ ...context, key: 'cancel-3', name: 'sell', options: { cancel: listing2.listingId } }, { community: members(), economy: economy() });
  assert.match(messages.at(-1), /cancelled/i);
  await bot.respondToCommand({ ...context, key: 'cancel-4', name: 'sell', options: { cancel: listing2.listingId } }, { community: members(), economy: economy() });
  assert.doesNotMatch(messages.at(-1), /cancelled/i);
  assert.equal((await pool.query('SELECT status FROM games.listings WHERE listing_id=$1', [listing2.listingId])).rows[0].status, 'cancelled');
  // Concurrent buy and cancel: exactly one winner, funds conserved.
  await fund(bob, 100, 'fund-bob-race');
  const card3 = await economy().issueCard({ guildId: guild, userId: alice, cardId: 'test-card', key: 'issue-3' });
  const listing3 = await economy().createListing({ guildId: guild, userId: alice, instanceId: card3.instanceId, price: 40, key: 'race-list' });
  const before = { alice: await economy().balance(guild, alice), bob: await economy().balance(guild, bob) };
  const race = await Promise.allSettled([
    economy().buy({ guildId: guild, userId: bob, listingId: listing3.listingId, key: 'race-buy' }),
    economy().cancelListing({ guildId: guild, userId: alice, listingId: listing3.listingId, key: 'race-cancel' }),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const status = (await pool.query('SELECT status FROM games.listings WHERE listing_id=$1', [listing3.listingId])).rows[0].status;
  assert.ok(['sold', 'cancelled'].includes(status));
  const after = { alice: await economy().balance(guild, alice), bob: await economy().balance(guild, bob) };
  if (status === 'sold') {
    assert.equal(after.alice, String(BigInt(before.alice) + 40n));
    assert.equal(after.bob, String(BigInt(before.bob) - 40n));
  } else {
    assert.deepEqual(after, before);
  }
});
test('opening an unaffordable pack rolls back minted cards and supply counters', async () => {
  await catalog(2);
  await economy().definePack({ packId: 'starter', name: 'Starter', price: 10, size: 1, adminOnly: false, items: [{ cardId: 'test-card', weight: 1 }] });
  await assert.rejects(economy().openPack({ guildId: guild, userId: alice, packId: 'starter', key: 'open', isAdmin: false }), /insufficient-funds/);
  assert.equal((await economy().inventory(guild, alice)).length, 0);
  assert.equal((await pool.query('SELECT issued_count FROM games.card_definitions')).rows[0].issued_count, '0');
});
test('outbox delivery persists success and does not redeliver completed notifications', async () => {
  await registerDeliveryGuild();
  const { deliverCommunityMessages } = await import('../../packages/flow/dist/community-outbox.js');
  await members().configure(guild, { welcomeChannelId: bob });
  await members().memberEvent({ guildId: guild, userId: alice, guildName: 'Test', memberCount: 1, event: 'join', key: 'event' });
  const sent = [];
  assert.equal(await deliverCommunityMessages(pool, [guild], async payload => sent.push(payload), 'himiko'), 1);
  assert.equal(await deliverCommunityMessages(pool, [guild], async payload => sent.push(payload), 'himiko'), 0);
  assert.equal(sent.length, 1); assert.equal(sent[0].channelId, bob);
});
test('outbox delivery failures retain the event with bounded retry diagnostics', async () => {
  await registerDeliveryGuild();
  const { deliverCommunityMessages } = await import('../../packages/flow/dist/community-outbox.js');
  await members().configure(guild, { welcomeChannelId: bob });
  await members().memberEvent({ guildId: guild, userId: alice, guildName: 'Test', memberCount: 1, event: 'join', key: 'event' });
  assert.equal(await deliverCommunityMessages(pool, [guild], async () => { throw new Error('private-provider-detail'); }, 'himiko'), 0);
  const r = (await pool.query('SELECT published,attempts,last_error FROM ops.outbox')).rows[0];
  assert.deepEqual(r, { published: false, attempts: 1, last_error: 'delivery-failed' });
});

// --- A12/7C: durable staff notifications for payment claims ---
const claimNotification = (key, payload) =>
  pool.query(
    `INSERT INTO ops.outbox(aggregate,aggregate_id,type,payload,correlation_id) VALUES('commerce.claim',$1,'commerce.notification',$2,$3)`,
    [guild, JSON.stringify({ category: 'orders', ...payload }), key],
  );

test('commerce staff notifications deliver durably and are never redelivered', async () => {
  await registerDeliveryGuild();
  const { deliverCommerceNotifications } = await import('../../packages/flow/dist/community-outbox.js');
  await claimNotification('test-claim-1', { orderId: 'RP-TEST01', buyerId: alice, serviceName: 'Membership', amountMinor: 70000, method: 'upi', proofRef: 'upi:123456789012' });
  const sent = [];
  assert.equal(await deliverCommerceNotifications(pool, [guild], async (payload, nonce) => sent.push({ payload, nonce }), 'himiko'), 1);
  assert.equal(sent[0].payload.orderId, 'RP-TEST01');
  assert.equal(sent[0].payload.amountMinor, 70000);
  assert.equal((await pool.query(`SELECT published FROM ops.outbox WHERE correlation_id='test-claim-1'`)).rows[0].published, true);
  assert.equal(await deliverCommerceNotifications(pool, [guild], async () => sent.push('again'), 'himiko'), 0, 'a delivered notification is never redelivered');
  assert.equal(sent.length, 1);
});

test('failed commerce notification delivery retries after restart and honors the orders preference', async () => {
  await registerDeliveryGuild();
  const { deliverCommerceNotifications } = await import('../../packages/flow/dist/community-outbox.js');
  await claimNotification('test-claim-2', { orderId: 'RP-TEST02', buyerId: alice });
  assert.equal(await deliverCommerceNotifications(pool, [guild], async () => { throw new Error('provider down'); }, 'himiko'), 0);
  const failed = (await pool.query(`SELECT published,attempts,last_error FROM ops.outbox WHERE correlation_id='test-claim-2'`)).rows[0];
  assert.equal(failed.published, false);
  assert.equal(failed.attempts, 1);
  assert.equal(failed.last_error, 'delivery-failed');
  await pool.query(`UPDATE ops.outbox SET next_attempt_at=now() WHERE correlation_id='test-claim-2'`);
  const sent = [];
  assert.equal(await deliverCommerceNotifications(pool, [guild], async payload => sent.push(payload), 'himiko'), 1, 'a restarted consumer picks the event back up');
  assert.equal(sent[0].orderId, 'RP-TEST02');
  await pool.query(
    `INSERT INTO config.guild_controls(guild_id, notifications_enabled, notification_preferences, updated_by) VALUES($1, true, '{"orders":false}'::jsonb, 'test')
     ON CONFLICT(guild_id) DO UPDATE SET notifications_enabled=true, notification_preferences='{"orders":false}'::jsonb`,
    [guild],
  );
  await claimNotification('test-claim-3', { orderId: 'RP-TEST03', buyerId: alice });
  assert.equal(await deliverCommerceNotifications(pool, [guild], async () => sent.push('gated'), 'himiko'), 0, 'the orders preference stops delivery');
  assert.equal(sent.length, 1);
  await pool.query(`UPDATE config.guild_controls SET notification_preferences='{}'::jsonb WHERE guild_id=$1`, [guild]);
});
