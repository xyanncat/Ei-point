import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DURABLE_ASSETS,
  RPO_TARGETS,
  RTO_TARGET_HOURS,
  validateDurableInventory,
  listBackedUpPaths,
  privateVolumes,
} from './durable-assets.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const restic = readFileSync(join(root, 'infra/backup/restic-backup.sh'), 'utf8');

test('the inventory covers every required durable category with owner, path, retention and restore validation', () => {
  const classes = new Set(DURABLE_ASSETS.map((asset) => asset.classification));
  for (const required of ['database', 'unique-private', 'reprovisionable', 'secret'])
    assert.ok(classes.has(required), `inventory must classify ${required} assets`);
  const covered = DURABLE_ASSETS.map((asset) => `${asset.id} ${asset.runtimePath}`.toLowerCase()).join('\n');
  for (const topic of ['wal', 'artwork', 'persona', 'reference', 'model', 'env']) {
    assert.match(covered, new RegExp(topic), `inventory must include the ${topic} durable asset`);
  }
  for (const asset of DURABLE_ASSETS) {
    assert.ok(asset.owner && asset.retention && asset.restoreValidation && asset.integrity, `${asset.id} is incomplete`);
  }
});

test('every unique/private asset has an encrypted off-host copy, an integrity hash and a restore check', () => {
  const privates = DURABLE_ASSETS.filter((asset) => asset.classification === 'unique-private');
  assert.ok(privates.length >= 3, 'reference audio, persona memory and artwork are unique/private');
  for (const asset of privates) {
    assert.ok(asset.backup.some((method) => /restic/.test(method)), `${asset.id} must be in the encrypted off-host restic set`);
    assert.match(asset.integrity, /sha-?256|hash|manifest/i, `${asset.id} must record an integrity hash`);
    assert.match(asset.restoreValidation, /\S/, `${asset.id} must name how recovery is validated`);
  }
});

test('public weights are reprovisionable by pinned hash, not backed up as unique assets', () => {
  const models = DURABLE_ASSETS.filter((asset) => asset.classification === 'reprovisionable');
  assert.ok(models.length >= 2, 'Qwen and Hy-MT2 weights are reprovisionable');
  for (const asset of models) {
    assert.match(asset.provisioning, /prepare_(qwen|hymt2)_model\.py/, `${asset.id} must name its provisioning command`);
    assert.ok(!asset.backup.some((method) => /restic/.test(method)), `${asset.id} must not be a unique restic asset`);
  }
});

test('the inventory validator fails closed on an under-protected or unsafe asset', () => {
  const ok = validateDurableInventory(DURABLE_ASSETS);
  assert.deepEqual(ok, [], JSON.stringify(ok));
  const ignore = (issues) => issues.map((entry) => entry.code);
  const noRest = validateDurableInventory([
    { id: 'x', owner: 'o', classification: 'unique-private', runtimePath: '/srv/private/x', backup: ['logical:tar'], integrity: 'sha256', retention: 'r', restoreValidation: 'r' },
  ]);
  assert.ok(ignore(noRest).includes('private-not-backed-up'));
  const noHash = validateDurableInventory([
    { id: 'x', owner: 'o', classification: 'unique-private', runtimePath: '/srv/private/x', backup: ['off-host:restic'], integrity: '', retention: 'r', restoreValidation: 'r' },
  ]);
  assert.ok(ignore(noHash).includes('private-without-integrity'));
  const unsafe = validateDurableInventory([
    { id: 'x', owner: 'o', classification: 'reprovisionable', runtimePath: '../../etc/passwd', provisioning: 'x', integrity: 'sha256', retention: 'r', restoreValidation: 'r' },
  ]);
  assert.ok(ignore(unsafe).includes('unsafe-runtime-path'));
  const noProvision = validateDurableInventory([
    { id: 'x', owner: 'o', classification: 'reprovisionable', runtimePath: '/srv/models/x', integrity: 'sha256', retention: 'r', restoreValidation: 'r' },
  ]);
  assert.ok(ignore(noProvision).includes('reprovisionable-without-provisioning'));
});

test('the real off-host backup includes private paths through the shared inventory and fails closed', async () => {
  // Wire-through: the restic script must resolve the private set from the inventory.
  assert.match(restic, /durable-assets\.mjs/, 'restic-backup.sh must use the durable-asset inventory');
  assert.match(restic, /--list-private/, 'restic-backup.sh must request the private/secret paths');
  for (const publicDir of ['qwen3-tts', 'hy-mt2'])
    assert.doesNotMatch(restic, new RegExp(publicDir), 'public weights are reprovisioned, not backed up as unique assets');

  const directory = await mkdtemp(join(tmpdir(), 'ei-durable-'));
  const reference = join(directory, 'cyrene-reference.mp3');
  const persona = join(directory, 'persona.md');
  const envFile = join(directory, 'deployment.env');
  await writeFile(reference, 'reference-bytes');
  await writeFile(persona, 'persona');
  await writeFile(envFile, 'POSTGRES_ADMIN_PASSWORD=test-only\n');
  const base = { ENV_FILE: envFile };
  const good = listBackedUpPaths({ ...base, CYRENE_REFERENCE_AUDIO_PATH: reference, CYRENE_PERSONA_MEMORY_FILE: persona });
  assert.deepEqual(good.missing, []);
  assert.ok(good.paths.includes(reference) && good.paths.includes(persona), 'private paths must be backed up');

  const incomplete = listBackedUpPaths({ ...base, CYRENE_REFERENCE_AUDIO_PATH: join(directory, 'gone.mp3'), CYRENE_PERSONA_MEMORY_FILE: persona });
  assert.deepEqual(incomplete.missing.map((entry) => entry.id).sort(), ['cyrene-reference-audio'], 'a missing required private asset must be reported');
});

test('the off-host restic volume set covers the private artwork and the physical pgbackrest repository, never live pgdata', () => {
  // Regression guard: the wal-archive/pgbackrest volume is classification
  // "database" but must still ride the off-host set; the live pgdata volume must not.
  const volumes = privateVolumes().sort();
  assert.deepEqual(volumes, ['artwork', 'pgbackrest'], `unexpected restic volume set: ${volumes.join(',')}`);
  const withoutMarker = validateDurableInventory([
    { id: 'x', owner: 'o', classification: 'unique-private', runtimePath: 'docker-volume:x', backup: ['off-host:restic(encrypted)'], integrity: 'sha256', retention: 'r', restoreValidation: 'r' },
  ]);
  assert.ok(withoutMarker.some((entry) => entry.code === 'private-volume-not-in-restic-set'));
});

test('the proposed RPO/RTO targets match the plan and are documented', () => {
  assert.equal(RPO_TARGETS.databaseMinutes, 15);
  assert.equal(RPO_TARGETS.uniqueAssetsHours, 6);
  assert.equal(RPO_TARGETS.offHostCopyHours, 24);
  assert.equal(RTO_TARGET_HOURS, 2);
  const doc = join(root, 'docs/operations/durable-assets.md');
  assert.ok(existsSync(doc), 'docs/operations/durable-assets.md must exist (§9B deliverable)');
  const text = readFileSync(doc, 'utf8');
  for (const asset of DURABLE_ASSETS) assert.match(text, new RegExp(asset.id), `durable-assets.md must document ${asset.id}`);
});

test('the list-private CLI reports missing required assets as a failure', async () => {
  const { spawnSync } = await import('node:child_process');
  const cli = join(root, 'infra/backup/durable-assets.mjs');
  const empty = spawnSync(process.execPath, [cli, '--list-private'], { encoding: 'utf8', env: { ...process.env, ENV_FILE: '', CYRENE_REFERENCE_AUDIO_PATH: '', CYRENE_PERSONA_MEMORY_FILE: '' } });
  assert.notEqual(empty.status, 0, 'unset required private assets must fail the backup');
  const directory = await mkdtemp(join(tmpdir(), 'ei-durable-cli-'));
  const reference = join(directory, 'ref.mp3');
  await writeFile(reference, 'x');
  const persona = join(directory, 'p.md');
  await writeFile(persona, 'y');
  const envFile = join(directory, 'deployment.env');
  await writeFile(envFile, 'POSTGRES_ADMIN_PASSWORD=test-only\n');
  const ok = spawnSync(process.execPath, [cli, '--list-private'], { encoding: 'utf8', env: { ...process.env, ENV_FILE: envFile, CYRENE_REFERENCE_AUDIO_PATH: reference, CYRENE_PERSONA_MEMORY_FILE: persona } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /ref\.mp3/);
});
