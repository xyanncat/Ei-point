import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchGuildCommand } from '../../packages/flow/dist/discord-dispatch.js';
import { createWorkGate, createInteractionClaims } from '../../packages/flow/dist/capacity.js';
import { communityCommandPermissionDenial } from '../../apps/bots/community/dist/authorization.js';

function fixture(guildId='guild') {
  const events=[];
  const interaction={
    guildId,
    deferred:false,
    replied:false,
    lastReply:undefined,
    deferOptions:undefined,
    async deferReply(options){events.push('defer');this.deferred=true;this.deferOptions=options;},
    async reply(message){events.push('reply');this.replied=true;this.lastReply=message;assert.equal(message.ephemeral,true);},
    async editReply(message){events.push('edit');this.lastReply=message;assert.ok(message.content);},
  };
  return {events,interaction};
}

test('approved command goes through defer, authorization, work and one edit reply',async()=>{
  const {events,interaction}=fixture();let mutation=false;
  await dispatchGuildCommand({botKey:'himiko',allowlist:['guild'],interaction,
    authorize:async()=>{events.push('authorize');return undefined;},
    run:async()=>{events.push('run');mutation=true;return {content:'announcement sent'};},
    failureReply:()=>({content:'unconfirmed'}),onTelemetry:()=>{},
  });
  assert.equal(mutation,true);
  assert.deepEqual(events,['defer','authorize','run','edit']);
});

test('guild rejection replies ephemerally without acknowledging or running',async()=>{
  const {events,interaction}=fixture('unapproved');let mutation=false;
  await dispatchGuildCommand({botKey:'himiko',allowlist:['guild'],interaction,
    authorize:async()=>{throw new Error('must not authorize');},
    run:async()=>{mutation=true;return {content:'mutated'};},
    failureReply:()=>({content:'not approved'}),onTelemetry:()=>{},
  });
  assert.equal(mutation,false);
  assert.deepEqual(events,['reply']);
});

test('paused or role-restricted command never reaches side effects',async()=>{
  const {events,interaction}=fixture();let mutation=false;
  await dispatchGuildCommand({botKey:'himiko',allowlist:['guild'],interaction,
    authorize:async()=>{events.push('authorize');return {content:'paused'};},
    run:async()=>{mutation=true;return {content:'mutated'};},
    failureReply:()=>({content:'unconfirmed'}),onTelemetry:()=>{},
  });
  assert.equal(mutation,false);
  assert.deepEqual(events,['defer','authorize','edit']);
});

test('community settings and card administration require their command permissions before work',()=>{
  for(const name of ['setwelcome','setleave','testwelcome','xp','setlevelchannel']){
    assert.equal(communityCommandPermissionDenial(name,false,false),'Manage Server permission is required.');
    assert.equal(communityCommandPermissionDenial(name,true,false),null);
  }
  assert.equal(communityCommandPermissionDenial('cardadmin',true,false),'Only the guild owner can administer cards and berries.');
  assert.equal(communityCommandPermissionDenial('cardadmin',false,true),null);
  assert.equal(communityCommandPermissionDenial('rank',false,false),null);
});

test('identity and operation select reply visibility for the whole lifecycle', async () => {
  const cases = [
    { botKey: 'himiko', operation: 'leaderboard', ephemeral: false },
    { botKey: 'himiko', operation: 'embed', ephemeral: false },
    { botKey: 'himiko', operation: 'setwelcome', ephemeral: true },
    { botKey: 'silverwolf', operation: 'rank', ephemeral: false },
    { botKey: 'silverwolf', operation: 'market', ephemeral: false },
    { botKey: 'silverwolf', operation: 'cardadmin', ephemeral: true },
    { botKey: 'cipher', operation: 'payment', ephemeral: true },
    { botKey: 'cyrene', operation: 'speak', ephemeral: false },
    { botKey: 'kafka', operation: 'ban', ephemeral: true },
  ];
  for (const c of cases) {
    const { interaction } = fixture();
    await dispatchGuildCommand({
      botKey: c.botKey, allowlist: ['guild'], interaction, operation: c.operation,
      authorize: async () => undefined,
      run: async () => ({ content: 'ok' }),
      failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {},
    });
    assert.equal(interaction.deferOptions?.ephemeral, c.ephemeral, `${c.botKey} /${c.operation}`);
    assert.equal(interaction.lastReply.content, 'ok');
  }
});

test('failed_acknowledgement_answers_once_in_private_and_releases_capacity', async () => {
  const gate = createWorkGate(1);
  const { interaction } = fixture();
  interaction.deferReply = async () => { throw new Error('acknowledgement rejected'); };
  let ran = false;
  await dispatchGuildCommand({
    botKey: 'himiko', allowlist: ['guild'], interaction, gate, operation: 'rank',
    authorize: async () => undefined,
    run: async () => { ran = true; return { content: 'no' }; },
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {}, ackTimeoutMs: 50,
  });
  assert.equal(ran, false, 'failed acknowledgement must not start work');
  assert.match(interaction.lastReply.content, /failed:timeout/);
  assert.equal(interaction.lastReply.ephemeral, true, 'system failures stay private');
  assert.equal(gate.inFlight(), 0, 'capacity released when work never starts');
});

test('timed_out_work_keeps_capacity_until_settled', async () => {
  const gate = createWorkGate(1);
  const first = fixture();
  let finish;
  const timedOut = dispatchGuildCommand({
    botKey: 'kafka', allowlist: ['guild'], interaction: first.interaction, gate,
    authorize: async () => undefined,
    run: async () => new Promise((resolve) => { finish = () => resolve({ content: 'late result' }); }),
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {}, deadlineMs: 20,
  });
  await timedOut;
  assert.equal(gate.inFlight(), 1, 'non-cancellable work keeps its slot after the deadline');
  assert.match(first.interaction.lastReply.content, /failed:timeout/);
  const second = fixture();
  let secondRan = false;
  await dispatchGuildCommand({
    botKey: 'kafka', allowlist: ['guild'], interaction: second.interaction, gate,
    authorize: async () => undefined,
    run: async () => { secondRan = true; return { content: 'second' }; },
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {},
  });
  assert.equal(secondRan, false, 'capacity is not stolen while timed-out work is still running');
  assert.match(second.interaction.lastReply.content, /failed:queue-full/);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(gate.inFlight(), 0);
  const third = fixture();
  await dispatchGuildCommand({
    botKey: 'kafka', allowlist: ['guild'], interaction: third.interaction, gate,
    authorize: async () => undefined,
    run: async () => ({ content: 'third' }),
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {},
  });
  assert.equal(third.interaction.lastReply.content, 'third', 'capacity frees once the settled work releases it');
});

test('late_commit_is_fenced', async () => {
  const claims = createInteractionClaims({ ttlMs: 10_000 });
  let commits = 0;
  const run = async () => { commits += 1; return { content: `commit ${commits}` }; };
  const args = (interaction) => ({
    botKey: 'kafka', allowlist: ['guild'], interaction, claims, operationId: 'interaction-42',
    authorize: async () => undefined, run,
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {},
  });
  const first = fixture();
  await dispatchGuildCommand(args(first.interaction));
  assert.equal(commits, 1);
  const replay = fixture();
  await dispatchGuildCommand(args(replay.interaction));
  assert.equal(commits, 1, 'a late re-delivery of the same interaction must not commit twice');
  assert.match(replay.interaction.lastReply.content, /failed:duplicate/);
  const shortLived = createInteractionClaims({ ttlMs: 5 });
  await dispatchGuildCommand({ ...args(fixture().interaction), claims: shortLived, operationId: 'interaction-43' });
  await new Promise((resolve) => setTimeout(resolve, 15));
  await dispatchGuildCommand({ ...args(fixture().interaction), claims: shortLived, operationId: 'interaction-43' });
  assert.equal(commits, 3, 'beyond the interaction token lifetime a replay is a genuinely new operation');
});

test('duplicate_interaction_is_refused_while_in_flight', async () => {
  const claims = createInteractionClaims();
  let runs = 0;
  let finish;
  const first = fixture();
  const inFlight = dispatchGuildCommand({
    botKey: 'kafka', allowlist: ['guild'], interaction: first.interaction, claims, operationId: 'interaction-77',
    authorize: async () => undefined,
    run: async () => { runs += 1; return new Promise((resolve) => { finish = () => resolve({ content: 'done' }); }); },
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {},
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 1);
  const duplicate = fixture();
  let duplicateRan = false;
  await dispatchGuildCommand({
    botKey: 'kafka', allowlist: ['guild'], interaction: duplicate.interaction, claims, operationId: 'interaction-77',
    authorize: async () => undefined,
    run: async () => { duplicateRan = true; return { content: 'duplicate' }; },
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {},
  });
  assert.equal(duplicateRan, false, 'the duplicate delivery must not start a second run');
  assert.match(duplicate.interaction.lastReply.content, /failed:duplicate/);
  finish();
  await inFlight;
  assert.equal(first.interaction.lastReply.content, 'done');
});

test('flooded_requests_stay_bounded_while_an_adapter_stalls', async () => {
  const gate = createWorkGate(2);
  let concurrent = 0;
  let peak = 0;
  const stallers = [];
  const run = async () => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await new Promise((resolve) => stallers.push(resolve));
    concurrent -= 1;
    return { content: 'done' };
  };
  const pending = [];
  const refusals = [];
  for (let i = 0; i < 6; i += 1) {
    const { interaction } = fixture();
    pending.push(dispatchGuildCommand({
      botKey: 'kafka', allowlist: ['guild'], interaction, gate, operationId: `interaction-flood-${i}`,
      authorize: async () => undefined, run,
      failureReply: (category) => { refusals.push(category); return { content: `failed:${category}` }; },
      onTelemetry: () => {}, deadlineMs: 500,
    }));
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(peak, 2, 'actual concurrency never exceeds capacity while the adapter stalls');
  assert.equal(stallers.length, 2, 'excess requests are refused, not queued into work');
  assert.equal(gate.inFlight(), 2);
  assert.equal(refusals.filter((category) => category === 'queue-full').length, 4);
  for (const release of stallers) release();
  await Promise.all(pending);
  assert.equal(peak, 2);
  assert.equal(gate.inFlight(), 0);
});

test('shutdown_during_work_refuses_new_work_and_bounds_drain', async () => {
  const gate = createWorkGate(2);
  let finish;
  const first = fixture();
  const inFlight = dispatchGuildCommand({
    botKey: 'kafka', allowlist: ['guild'], interaction: first.interaction, gate, operationId: 'interaction-90',
    authorize: async () => undefined,
    run: async () => new Promise((resolve) => { finish = () => resolve({ content: 'late' }); }),
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {}, deadlineMs: 200,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(gate.inFlight(), 1);
  gate.close();
  const refused = fixture();
  let refusedRan = false;
  await dispatchGuildCommand({
    botKey: 'kafka', allowlist: ['guild'], interaction: refused.interaction, gate, operationId: 'interaction-91',
    authorize: async () => undefined,
    run: async () => { refusedRan = true; return { content: 'no' }; },
    failureReply: (category) => ({ content: `failed:${category}` }), onTelemetry: () => {},
  });
  assert.equal(refusedRan, false, 'closed gate refuses new work before any side effect');
  assert.match(refused.interaction.lastReply.content, /failed:shutting-down/);
  let drained;
  const drain = gate.drain(500).then((value) => { drained = value; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(drained, undefined, 'drain waits while real work is unsettled');
  finish();
  await drain;
  assert.equal(drained, true);
  assert.equal(gate.inFlight(), 0);
  await inFlight;
  const stuck = createWorkGate(1);
  stuck.tryAcquire();
  assert.equal(await stuck.drain(20), false, 'drain is bounded for work that never settles');
});
