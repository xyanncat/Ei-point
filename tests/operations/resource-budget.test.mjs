import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  validateResourceBudget,
  serviceResourcesFromCompose,
  APPROVED_RUNTIME,
  APPROVED_MAINTENANCE,
  POOL_CGROUP_PARENT,
} from '../../scripts/check-resource-budget.mjs';

const approved = () => structuredClone({ ...APPROVED_RUNTIME, ...APPROVED_MAINTENANCE });

test('approved pool allocation validates with the aggregate cgroup cap', () => {
  const result = validateResourceBudget(approved());
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.mode, 'pool');
  assert.equal(result.runtime.shares, 18688);
  assert.equal(result.runtime.memoryGiB, 32.5);
  assert.equal(result.concurrent.shares, 19200);
  assert.equal(result.concurrent.memoryGiB, 33.75);
});

test('pool mode requires the aggregate cgroup parent on every runtime service', () => {
  const services = approved();
  delete services['tts-qwen'].cgroupParent;
  const result = validateResourceBudget(services);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('tts-qwen') && v.includes(POOL_CGROUP_PARENT)));
});

test('memory stays mandatory and an explicit ceiling is still enforced', () => {
  const missing = approved();
  delete missing.workers.memoryGiB;
  const invalid = validateResourceBudget(missing);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.violations.some((v) => v.includes('workers')));

  const heavy = approved();
  heavy['tts-qwen'].memoryGiB = 100;
  const capped = validateResourceBudget(heavy, { memoryGiB: 40 });
  assert.equal(capped.ok, false);
  assert.ok(capped.violations.some((v) => v.includes('memory')));
  // The aggregate memory ceiling is retired by the owner decision.
  assert.equal(validateResourceBudget(heavy).ok, true);
});

test('hard-cpu mode remains validated against the 9 CPU ceiling', () => {
  const hard = Object.fromEntries(
    Object.entries(APPROVED_RUNTIME).map(([name, value]) => [name, { cpus: 0.25, memoryGiB: value.memoryGiB }]),
  );
  const ok = validateResourceBudget({ ...hard, ...APPROVED_MAINTENANCE });
  assert.equal(ok.ok, true, JSON.stringify(ok.violations));
  assert.equal(ok.mode, 'hard');

  const over = { ...hard, 'tts-qwen': { cpus: 20, memoryGiB: 8 } };
  const bad = validateResourceBudget({ ...over, ...APPROVED_MAINTENANCE });
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => v.includes('cpu')));
});

test('mixed CPU controls and invalid values are rejected', () => {
  const mixed = approved();
  mixed.api = { cpus: 0.35, memoryGiB: 1 };
  const result = validateResourceBudget(mixed);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('mixed')));

  const bad = approved();
  bad.web.shares = 'lots';
  const invalid = validateResourceBudget(bad);
  assert.ok(invalid.violations.some((v) => v.includes('web')));
});

test('compose extraction reads cpu_shares, memory and cgroup_parent', () => {
  const compose = {
    services: {
      tts: { cpu_shares: 8192, cgroup_parent: 'ei-point.slice', deploy: { resources: { limits: { memory: '8589934592' } } } },
      api: { deploy: { resources: { limits: { cpus: '0.35', memory: '1G' } } } },
      nginx: {},
    },
  };
  const resources = serviceResourcesFromCompose(compose);
  assert.equal(resources.tts.shares, 8192);
  assert.equal(resources.tts.memoryGiB, 8);
  assert.equal(resources.tts.cgroupParent, 'ei-point.slice');
  assert.equal(resources.api.cpus, 0.35);
  assert.equal(resources.api.memoryGiB, 1);
  assert.deepEqual(resources.nginx, {});
});

test('infra compose stays in sync with the approved pool allocation', () => {
  const composePath = fileURLToPath(new URL('../../infra/docker/compose.yml', import.meta.url));
  const text = readFileSync(composePath, 'utf8').replace(/\r\n/g, '\n');
  const parseMemory = (value) => {
    const amount = Number(value.slice(0, -1));
    return value.endsWith('M') ? amount / 1024 : amount;
  };
  for (const [service, expected] of Object.entries(APPROVED_RUNTIME)) {
    const block = new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nnetworks:)`).exec(text);
    assert.ok(block, `compose must define ${service}`);
    const shares = /cpu_shares: (\d+)/.exec(block[1]);
    const limits = /limits: \{ memory: ([0-9]+[GM]) \}/.exec(block[1]);
    const parent = /cgroup_parent: ([a-z.-]+)/.exec(block[1]);
    assert.ok(shares, `${service} must declare cpu_shares`);
    assert.equal(Number(shares[1]), expected.shares, `${service} share drift`);
    assert.ok(limits, `${service} must declare a memory limit`);
    assert.equal(parseMemory(limits[1]), expected.memoryGiB, `${service} memory drift`);
    assert.ok(parent, `${service} must declare cgroup_parent`);
    assert.equal(parent[1], POOL_CGROUP_PARENT);
  }
});
