import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateResourceBudget, serviceResourcesFromCompose, APPROVED_RUNTIME, APPROVED_MAINTENANCE } from '../../scripts/check-resource-budget.mjs';

test('the approved allocation fits the 8 CPU / 40 GiB envelope including concurrent maintenance', () => {
  const result = validateResourceBudget({ ...APPROVED_RUNTIME, ...APPROVED_MAINTENANCE });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(Math.round(result.runtime.cpu * 100) / 100, 7.45);
  assert.equal(result.runtime.memoryGiB, 32.5);
  assert.equal(Math.round(result.concurrent.cpu * 100) / 100, 7.95);
  assert.equal(result.concurrent.memoryGiB, 33.75);
});
test('rejects an over-budget selection with named violations', () => {
  const result = validateResourceBudget({ ...APPROVED_RUNTIME, ...APPROVED_MAINTENANCE, 'tts-qwen': { cpus: 3, memoryGiB: 8 } });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('cpu')));
});
test('rejects missing limits and invalid units', () => {
  const missing = validateResourceBudget({ ...APPROVED_RUNTIME, workers: {} });
  assert.equal(missing.ok, false);
  assert.ok(missing.violations.some(v => v.includes('workers')));
  const invalid = validateResourceBudget({ ...APPROVED_RUNTIME, api: { cpus: 'lots', memoryGiB: 1 } });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.violations.some(v => v.includes('api')));
});
test('rejects overlapping maintenance that exceeds the ceiling', () => {
  const overlapping = { ...APPROVED_RUNTIME, ...APPROVED_MAINTENANCE, 'backup-second': { cpus: 0.25, memoryGiB: 1 } };
  const railCpu = { ...overlapping, 'tts-qwen': { cpus: 1.25, memoryGiB: 8 } };
  const result = validateResourceBudget(railCpu);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('cpu')));
});
test('compose extraction reads deploy limits and reports missing entries', () => {
  const compose = {
    services: {
      api: { deploy: { resources: { limits: { cpus: '0.35', memory: '1G' } } } },
      web: { deploy: { resources: { limits: { cpus: 0.3, memory: '1024M' } } } },
      nginx: {},
    },
  };
  const resources = serviceResourcesFromCompose(compose);
  assert.equal(resources.api.cpus, 0.35);
  assert.equal(resources.api.memoryGiB, 1);
  assert.equal(resources.web.memoryGiB, 1);
  assert.deepEqual(resources.nginx, {});
});
test('infra compose deploy limits stay in sync with the approved allocation', () => {
  const composePath = fileURLToPath(new URL('../../infra/docker/compose.yml', import.meta.url));
  const text = readFileSync(composePath, 'utf8').replace(/\r\n/g, '\n');
  const parseMemory = (value) => {
    const amount = Number(value.slice(0, -1));
    return value.endsWith('M') ? amount / 1024 : amount;
  };
  for (const [service, expected] of Object.entries(APPROVED_RUNTIME)) {
    const block = new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nnetworks:)`).exec(text);
    assert.ok(block, `compose must define ${service}`);
    const limits = /limits: \{ cpus: "([\d.]+)", memory: ([0-9]+[GM]) \}/.exec(block[1]);
    assert.ok(limits, `${service} must declare deploy resource limits`);
    assert.equal(Number(limits[1]), expected.cpus, `${service} cpu drift`);
    assert.equal(parseMemory(limits[2]), expected.memoryGiB, `${service} memory drift`);
  }
});
