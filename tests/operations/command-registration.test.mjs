import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  planReconciliation,
  definitionsMatch,
} from '../../scripts/reconcile-command-registrations.mjs';

const slash = (overrides = {}) => ({
  id: '1',
  application_id: 'app',
  type: 1,
  name: 'ping',
  description: 'Check the gateway latency',
  options: [],
  default_member_permissions: null,
  dm_permission: null,
  nsfw: false,
  ...overrides,
});

test('exact guild duplicates are the only deletion candidates', () => {
  const global = [slash({ id: 'global-1' })];
  const guild = [slash({ id: 'guild-1' })];
  const plan = planReconciliation({ globalCommands: global, guildCommands: guild, guildId: 'g1' });
  assert.equal(plan.redundant.length, 1);
  assert.deepEqual(plan.redundant[0], {
    key: '1:ping', guildId: 'g1', globalId: 'global-1', guildIdValue: 'guild-1', name: 'ping', type: 1,
  });
  assert.equal(plan.mismatched.length, 0);
  assert.equal(plan.guildOnly.length, 0);
});

test('changed options or default permissions are mismatches, never deletions', () => {
  const global = [slash({ id: 'global-1' })];
  const optionDrift = planReconciliation({
    globalCommands: global,
    guildCommands: [slash({ id: 'guild-1', options: [{ type: 3, name: 'extra', description: 'x' }] })],
    guildId: 'g1',
  });
  assert.equal(optionDrift.redundant.length, 0);
  assert.equal(optionDrift.mismatched.length, 1);

  const permissionDrift = planReconciliation({
    globalCommands: global,
    guildCommands: [slash({ id: 'guild-1', default_member_permissions: '8' })],
    guildId: 'g1',
  });
  assert.equal(permissionDrift.redundant.length, 0);
  assert.equal(permissionDrift.mismatched.length, 1);
});

test('context menus, guild-only commands and other types are preserved', () => {
  const global = [slash({ id: 'global-1' })];
  const guild = [
    slash({ id: 'user-1', type: 2, name: 'ping' }),
    slash({ id: 'rank-1', name: 'rank' }),
  ];
  const plan = planReconciliation({ globalCommands: global, guildCommands: guild, guildId: 'g1' });
  assert.equal(plan.redundant.length, 0);
  assert.equal(plan.guildOnly.length, 2);
});

test('commands with permission overrides are blocked from deletion', () => {
  const plan = planReconciliation({
    globalCommands: [slash({ id: 'global-1' })],
    guildCommands: [slash({ id: 'guild-1' })],
    guildId: 'g1',
    blockedCommandIds: ['guild-1'],
  });
  assert.equal(plan.redundant.length, 0);
  assert.equal(plan.permissionBlocked.length, 1);
});

test('a second reconciliation after deletion plans no changes', () => {
  const first = planReconciliation({ globalCommands: [slash({ id: 'g' })], guildCommands: [slash({ id: 'x' })], guildId: 'g1' });
  assert.equal(first.redundant.length, 1);
  const second = planReconciliation({ globalCommands: [slash({ id: 'g' })], guildCommands: [], guildId: 'g1' });
  assert.equal(second.redundant.length, 0);
  assert.equal(second.mismatched.length + second.guildOnly.length + second.permissionBlocked.length, 0);
});

test('definition comparison ignores scope IDs but catches contract changes', () => {
  assert.equal(definitionsMatch(slash({ id: 'a' }), slash({ id: 'b', application_id: 'other' })), true);
  assert.equal(definitionsMatch(slash(), slash({ description: 'different' })), false);
  assert.equal(definitionsMatch(slash(), slash({ nsfw: true })), false);
  assert.equal(definitionsMatch(slash(), slash({ contexts: [0, 1, 2] })), false);
});

test('active bot sources register globally and never write guild-scoped commands', () => {
  const bots = [
    'apps/bots/ai/src/index.ts',
    'apps/bots/kafka/src/index.ts',
    'apps/bots/commerce/src/index.ts',
    'apps/bots/community/src/index.ts',
    'apps/bots/himiko/src/index.ts',
  ];
  for (const path of bots) {
    const text = readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
    assert.ok(!text.includes('applicationGuildCommands'), `${path} must not register guild commands`);
    assert.ok(text.includes('Routes.applicationCommands'), `${path} must register global commands`);
  }
  const robin = readFileSync(fileURLToPath(new URL('../../apps/bots/music-py/src/main.py', import.meta.url)), 'utf8');
  assert.match(robin, /tree\.sync\(\)/);
  assert.match(robin, /clear_commands\(guild=/);
});
