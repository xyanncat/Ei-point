#!/usr/bin/env node
// Enforce the project resource envelope (8 CPU / 40 GiB) for a selected release (A02).
// Usage: node scripts/check-resource-budget.mjs [rendered-compose.json]
// Without an argument the approved in-repo allocation is validated.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CPU_CEILING = 8;
export const MEMORY_CEILING_GIB = 40;

/** Approved runtime allocation (plan §2A). Keep in sync with infra/docker/compose.yml. */
export const APPROVED_RUNTIME = {
  postgres: { cpus: 1.25, memoryGiB: 6 },
  nginx: { cpus: 0.15, memoryGiB: 0.5 },
  api: { cpus: 0.35, memoryGiB: 1 },
  web: { cpus: 0.30, memoryGiB: 1 },
  "bot-community": { cpus: 0.40, memoryGiB: 2 },
  "bot-ai": { cpus: 0.50, memoryGiB: 2 },
  "hy-mt2": { cpus: 1.00, memoryGiB: 4 },
  "tts-qwen": { cpus: 0.75, memoryGiB: 8 },
  "bot-music": { cpus: 0.75, memoryGiB: 2 },
  "bot-kafka": { cpus: 0.75, memoryGiB: 1.5 },
  "bot-himiko": { cpus: 0.35, memoryGiB: 1.5 },
  "bot-commerce": { cpus: 0.40, memoryGiB: 1.5 },
  workers: { cpus: 0.50, memoryGiB: 1.5 },
};

/** Allowed concurrently with the runtime during maintenance windows. */
export const APPROVED_MAINTENANCE = {
  migrate: { cpus: 0.25, memoryGiB: 0.25 },
  backup: { cpus: 0.25, memoryGiB: 1 },
};

const RUNTIME_SERVICES = new Set(Object.keys(APPROVED_RUNTIME));
const MAINTENANCE_SERVICES = new Set(Object.keys(APPROVED_MAINTENANCE));
const LEGACY_SERVICES = new Set(["bot-security", "bot-moderation"]);

function parseMemoryGiB(value) {
  if (typeof value === "number") return value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = /^([0-9.]+)\s*(G|GiB|M|MiB|m)?$/u.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? "G").toLowerCase();
  if (unit === "m" || unit === "mib") return amount / 1024;
  return amount;
}

/** Read deploy resource limits from a rendered compose JSON (docker compose config --format json). */
export function serviceResourcesFromCompose(compose) {
  const entries = Object.entries(compose?.services ?? {});
  return Object.fromEntries(
    entries.map(([name, service]) => {
      const limits = service?.deploy?.resources?.limits;
      if (!limits || limits.cpus === undefined || limits.memory === undefined) return [name, {}];
      const cpus = typeof limits.cpus === "string" ? Number(limits.cpus) : limits.cpus;
      const memoryGiB = parseMemoryGiB(limits.memory);
      return [name, { cpus: Number.isFinite(cpus) ? cpus : undefined, memoryGiB: memoryGiB ?? undefined }];
    }),
  );
}

function normalize(services) {
  const violations = [];
  const normalized = {};
  for (const [name, limits] of Object.entries(services)) {
    const cpus = typeof limits.cpus === "string" ? Number(limits.cpus) : limits.cpus;
    const memoryGiB = limits.memoryGiB ?? parseMemoryGiB(limits.memory);
    if (!Number.isFinite(cpus) || cpus <= 0 || !Number.isFinite(memoryGiB) || memoryGiB <= 0) {
      violations.push(`${name}: missing or invalid CPU/memory limits`);
      continue;
    }
    normalized[name] = { cpus, memoryGiB };
  }
  return { normalized, violations };
}

/** Returns totals and violations for a service->{cpus,memoryGiB} map. */
export function validateResourceBudget(services, { cpu = CPU_CEILING, memoryGiB = MEMORY_CEILING_GIB } = {}) {
  const { normalized, violations } = normalize(services);
  const runtimeNames = Object.keys(normalized).filter((name) => RUNTIME_SERVICES.has(name));
  const maintenanceNames = Object.keys(normalized).filter((name) => !RUNTIME_SERVICES.has(name) && !LEGACY_SERVICES.has(name));
  const unknownNames = Object.keys(normalized).filter((name) => !RUNTIME_SERVICES.has(name) && !MAINTENANCE_SERVICES.has(name) && !LEGACY_SERVICES.has(name));
  for (const name of unknownNames) violations.push(`${name}: not part of the approved allocation`);
  const sum = (names) =>
    names.reduce((total, name) => ({ cpu: total.cpu + normalized[name].cpus, memoryGiB: total.memoryGiB + normalized[name].memoryGiB }), { cpu: 0, memoryGiB: 0 });
  const runtime = sum(runtimeNames);
  const maintenance = sum(maintenanceNames);
  const concurrent = { cpu: runtime.cpu + maintenance.cpu, memoryGiB: runtime.memoryGiB + maintenance.memoryGiB };
  if (concurrent.cpu > cpu) violations.push(`concurrent cpu ${concurrent.cpu.toFixed(2)} exceeds ceiling ${cpu}`);
  if (concurrent.memoryGiB > memoryGiB) violations.push(`concurrent memory ${concurrent.memoryGiB.toFixed(2)} GiB exceeds ceiling ${memoryGiB}`);
  return { ok: violations.length === 0, violations, runtime, maintenance, concurrent };
}

async function main() {
  const file = process.argv[2];
  let services = { ...APPROVED_RUNTIME, ...APPROVED_MAINTENANCE };
  if (file) {
    const compose = JSON.parse(await readFile(resolve(file), "utf8"));
    // Rendered releases contain runtime services only; add the maintenance allowances
    // that overlap them during deploy/backup windows (constants win over missing rows).
    services = { ...APPROVED_MAINTENANCE, ...serviceResourcesFromCompose(compose) };
  }
  const result = validateResourceBudget(services);
  if (!result.ok) {
    console.error(`Resource budget check failed: ${result.violations.length} violation(s).`);
    for (const violation of result.violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Resource budget ok: runtime ${result.runtime.cpu.toFixed(2)} CPU / ${result.runtime.memoryGiB} GiB; concurrent ${result.concurrent.cpu.toFixed(2)} CPU / ${result.concurrent.memoryGiB} GiB.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
