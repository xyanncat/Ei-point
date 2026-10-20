#!/usr/bin/env node
// Enforce the project resource envelope for a selected release (A02).
// Owner decision: Ei Point is the only project on this 10-vCPU host. Runtime CPU is
// pooled with weighted CFS shares; the aggregate cap is the ei-point.slice
// (CPUQuota=900%) that every container must belong to. CPU shares are fairness
// weights, not a reservation or a hard per-service cap. Memory limits stay
// mandatory per service; the aggregate memory ceiling is retired (null = uncapped).
// Usage: node scripts/check-resource-budget.mjs [rendered-compose.json]
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CPU_CEILING = 9;
export const MEMORY_CEILING_GIB = null;
export const POOL_CGROUP_PARENT = "ei-point.slice";

/** Approved runtime allocation. Keep in sync with infra/docker/compose.yml. */
export const APPROVED_RUNTIME = {
  postgres: { shares: 2048, memoryGiB: 6, cgroupParent: POOL_CGROUP_PARENT },
  nginx: { shares: 256, memoryGiB: 0.5, cgroupParent: POOL_CGROUP_PARENT },
  api: { shares: 1024, memoryGiB: 1, cgroupParent: POOL_CGROUP_PARENT },
  web: { shares: 1024, memoryGiB: 1, cgroupParent: POOL_CGROUP_PARENT },
  "bot-community": { shares: 512, memoryGiB: 2, cgroupParent: POOL_CGROUP_PARENT },
  "bot-ai": { shares: 512, memoryGiB: 2, cgroupParent: POOL_CGROUP_PARENT },
  "hy-mt2": { shares: 2048, memoryGiB: 4, cgroupParent: POOL_CGROUP_PARENT },
  tts: { shares: 4096, memoryGiB: 4, cgroupParent: POOL_CGROUP_PARENT },
  "bot-music": { shares: 512, memoryGiB: 2, cgroupParent: POOL_CGROUP_PARENT },
  "bot-kafka": { shares: 512, memoryGiB: 1.5, cgroupParent: POOL_CGROUP_PARENT },
  "bot-himiko": { shares: 512, memoryGiB: 1.5, cgroupParent: POOL_CGROUP_PARENT },
  "bot-commerce": { shares: 512, memoryGiB: 1.5, cgroupParent: POOL_CGROUP_PARENT },
  workers: { shares: 1024, memoryGiB: 1.5, cgroupParent: POOL_CGROUP_PARENT },
};

/** Allowed concurrently with the runtime during maintenance windows. */
export const APPROVED_MAINTENANCE = {
  migrate: { shares: 256, memoryGiB: 0.25, cgroupParent: POOL_CGROUP_PARENT },
  backup: { shares: 256, memoryGiB: 1, cgroupParent: POOL_CGROUP_PARENT },
};

const RUNTIME_SERVICES = new Set(Object.keys(APPROVED_RUNTIME));
const MAINTENANCE_SERVICES = new Set(Object.keys(APPROVED_MAINTENANCE));
const LEGACY_SERVICES = new Set(["bot-security", "bot-moderation"]);

function parseMemoryGiB(value) {
  // Rendered Compose emits byte counts (string or number); the in-repo contract uses GiB.
  if (typeof value === "number") return value > 0 ? value / 1024 ** 3 : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    const bytes = Number(trimmed);
    return bytes > 0 ? bytes / 1024 ** 3 : null;
  }
  const match = /^([0-9.]+)\s*(G|GiB|M|MiB|m)?$/u.exec(trimmed);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? "G").toLowerCase();
  if (unit === "m" || unit === "mib") return amount / 1024;
  return amount;
}

function positiveNumber(value) {
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Read deploy resource controls from a rendered compose JSON (docker compose config --format json). */
export function serviceResourcesFromCompose(compose) {
  const entries = Object.entries(compose?.services ?? {});
  return Object.fromEntries(
    entries.map(([name, service]) => {
      const limits = service?.deploy?.resources?.limits ?? {};
      const cpus = positiveNumber(limits.cpus);
      const shares = positiveNumber(service?.cpu_shares);
      const memoryGiB = parseMemoryGiB(limits.memory);
      return [
        name,
        {
          ...(cpus ? { cpus } : {}),
          ...(shares ? { shares } : {}),
          ...(memoryGiB ? { memoryGiB } : {}),
          ...(service?.cgroup_parent ? { cgroupParent: service.cgroup_parent } : {}),
        },
      ];
    }),
  );
}

function normalize(services) {
  const violations = [];
  const normalized = {};
  for (const [name, limits] of Object.entries(services)) {
    const cpus = positiveNumber(limits.cpus);
    const shares = positiveNumber(limits.shares);
    const memoryGiB = limits.memoryGiB ?? parseMemoryGiB(limits.memory);
    if (cpus && shares) {
      violations.push(`${name}: declare either limits.cpus or cpu_shares, not both`);
      continue;
    }
    if ((!cpus && !shares) || !Number.isFinite(memoryGiB) || memoryGiB <= 0) {
      violations.push(`${name}: missing or invalid CPU/memory limits`);
      continue;
    }
    normalized[name] = {
      ...(cpus ? { cpus } : {}),
      ...(shares ? { shares } : {}),
      memoryGiB,
      cgroupParent: String(limits.cgroupParent ?? "").trim(),
    };
  }
  return { normalized, violations };
}

/** Totals and violations for a service->{cpus|shares,memoryGiB,cgroupParent} map. */
export function validateResourceBudget(services, { cpu = CPU_CEILING, memoryGiB = MEMORY_CEILING_GIB } = {}) {
  const { normalized, violations } = normalize(services);
  const names = Object.keys(normalized);
  const runtimeNames = names.filter((name) => RUNTIME_SERVICES.has(name));
  const maintenanceNames = names.filter((name) => !RUNTIME_SERVICES.has(name) && !LEGACY_SERVICES.has(name));
  const unknownNames = names.filter((name) => !RUNTIME_SERVICES.has(name) && !MAINTENANCE_SERVICES.has(name) && !LEGACY_SERVICES.has(name));
  for (const name of unknownNames) violations.push(`${name}: not part of the approved allocation`);

  const poolMode = runtimeNames.length > 0 && runtimeNames.every((name) => normalized[name].shares !== undefined);
  const hardMode = runtimeNames.length > 0 && runtimeNames.every((name) => normalized[name].cpus !== undefined);
  if (!poolMode && !hardMode) {
    violations.push("mixed CPU control: use cpu_shares (pool) or limits.cpus (hard) for every runtime service");
  }
  if (poolMode) {
    for (const name of runtimeNames) {
      if (normalized[name].cgroupParent !== POOL_CGROUP_PARENT) {
        violations.push(`${name}: cpu_shares requires cgroup_parent ${POOL_CGROUP_PARENT} for the aggregate cap`);
      }
    }
  }

  const sum = (list) =>
    list.reduce(
      (total, name) => ({
        cpu: total.cpu + (normalized[name].cpus ?? 0),
        shares: total.shares + (normalized[name].shares ?? 0),
        memoryGiB: total.memoryGiB + normalized[name].memoryGiB,
      }),
      { cpu: 0, shares: 0, memoryGiB: 0 },
    );
  const runtime = sum(runtimeNames);
  const maintenance = sum(maintenanceNames);
  const concurrent = {
    cpu: runtime.cpu + maintenance.cpu,
    shares: runtime.shares + maintenance.shares,
    memoryGiB: runtime.memoryGiB + maintenance.memoryGiB,
  };
  if (hardMode && concurrent.cpu > cpu) violations.push(`concurrent cpu ${concurrent.cpu.toFixed(2)} exceeds ceiling ${cpu}`);
  if (memoryGiB != null && concurrent.memoryGiB > memoryGiB) violations.push(`concurrent memory ${concurrent.memoryGiB.toFixed(2)} GiB exceeds ceiling ${memoryGiB}`);
  return { ok: violations.length === 0, violations, mode: poolMode ? "pool" : hardMode ? "hard" : "invalid", runtime, maintenance, concurrent };
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
  const cpuText = result.mode === "pool"
    ? `${result.runtime.shares} shares (capped by ${POOL_CGROUP_PARENT} at ${CPU_CEILING} CPU)`
    : `${result.runtime.cpu.toFixed(2)} CPU`;
  console.log(`Resource budget ok (${result.mode} mode): runtime ${cpuText} / ${result.runtime.memoryGiB} GiB; concurrent ${result.concurrent.memoryGiB} GiB.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
