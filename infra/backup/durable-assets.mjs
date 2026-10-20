#!/usr/bin/env node
// Durable-asset inventory and recovery contract (§9B / A19).
//
// One machine-checked source of truth for every durable asset: owner, runtime
// path, classification, backup/reprovision method, integrity hash, retention and
// restore validation. `--list-private` prints only the unique/private + secret
// paths that MUST be inside the encrypted off-host restic set and fails closed
// when a required asset is unconfigured or missing. Public weights are
// reprovisioned from their pinned manifest and are never treated as unique.
import { existsSync } from "node:fs";
import { isAbsolute, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const RPO_TARGETS = { databaseMinutes: 15, uniqueAssetsHours: 6, offHostCopyHours: 24 };
export const RTO_TARGET_HOURS = 2;

const RESTIC_METHOD = "off-host:restic(encrypted)";

export const DURABLE_ASSETS = [
  { id: "database", owner: "postgres", classification: "database", runtimePath: "docker-volume:pgdata", integrity: "PG checksums + physical backup manifest", backup: ["logical:bundle.mjs (postgres.dump+roles)", "off-host:restic(physical pgbackrest)", "PITR:WAL archive-push"], retention: "28 logical snapshots; 24h/7d/4w restic; 14d WAL window", restoreValidation: "scripts/restore-drill.sh logical bundle; pgBackRest physical/PITR drill", rpoMinutes: 15 },
  { id: "wal-archive", owner: "postgres", classification: "database", runtimePath: "docker-volume:pgbackrest", resticVolume: true, integrity: "pgBackRest backup.info/manifest", backup: ["off-host:restic(encrypted physical+WAL)"], retention: "14-day physical/WAL window", restoreValidation: "pgBackRest restore to a prior system identifier in isolation", rpoMinutes: 15 },
  { id: "artwork", owner: "api/dashboard", classification: "unique-private", runtimePath: "docker-volume:artwork", resticVolume: true, env: null, integrity: "sha256 in the logical bundle manifest", backup: [RESTIC_METHOD, "logical:artwork.tar.gz per-file bytes"], retention: "with the 6h logical tier and 24h/7d/4w restic tier", restoreValidation: "restore-drill.sh extracts and byte-checks every regular file", rpoHours: 6 },
  { id: "cyrene-reference-audio", owner: "cyrene (tts)", classification: "unique-private", runtimePath: "host:CYRENE_REFERENCE_AUDIO_PATH", env: "CYRENE_REFERENCE_AUDIO_PATH", integrity: "sha256 recorded at provision time", backup: [RESTIC_METHOD], retention: "with the off-host restic tier (max 24h copy age)", restoreValidation: "hash must match before Pocket voice-state preparation", rpoHours: 6 },
  { id: "cyrene-persona-memory", owner: "cyrene (bot-ai)", classification: "unique-private", runtimePath: "host:CYRENE_PERSONA_MEMORY_FILE", env: "CYRENE_PERSONA_MEMORY_FILE", integrity: "sha256 recorded at provision time", backup: [RESTIC_METHOD], retention: "with the off-host restic tier (max 24h copy age)", restoreValidation: "bot-ai rejects an unreadable/oversize persona and reports not-ready", rpoHours: 6 },
  { id: "deployment-secret", owner: "operator", classification: "secret", runtimePath: "host:ENV_FILE (.env)", env: "ENV_FILE", integrity: "filesystem perms 600 + encrypted restic snapshot", backup: [RESTIC_METHOD], retention: "with the off-host restic tier (max 24h copy age)", restoreValidation: "restore to a 600 file and re-run release health gates", rpoHours: 6 },
  { id: "pocket-tts-weights", owner: "operator (pocket-tts)", classification: "reprovisionable", runtimePath: "host:POCKET_TTS_HF_CACHE_PATH", env: "POCKET_TTS_HF_CACHE_PATH", integrity: "HF snapshot revision 983151f13aaeab1b13c1e5e3c2c383d49a9edf3f + manifest sha256", provisioning: "scripts/prepare_pocket_model.py --revision <sha>", backup: ["reprovision:pinned-hash"], retention: "n/a (public weights, gated access)", restoreValidation: "Pocket loads the pinned snapshot offline and tts reports ready", rpoHours: null },
  { id: "cyrene-pocket-voice-state", owner: "cyrene (pocket-tts)", classification: "unique-private", runtimePath: "host:POCKET_TTS_VOICE_STATE_PATH", env: "POCKET_TTS_VOICE_STATE_PATH", integrity: "sha256 c053f46f4a4004f13da28a7e3af88a5b8c86f074db145d2b54fccf6db3de4028", backup: [RESTIC_METHOD], retention: "with the off-host restic tier (max 24h copy age)", restoreValidation: "voice-state sha256 must match before tts will start ready", rpoHours: 6 },
  { id: "hy-mt2-weights", owner: "operator (hy-mt2)", classification: "reprovisionable", runtimePath: "host:HY_MT2_MODEL_PATH", env: "HY_MT2_MODEL_PATH", integrity: "ei-point-model.json + ei-point-model.sha256", provisioning: "scripts/prepare_hymt2_model.py --revision <sha>", backup: ["reprovision:pinned-hash"], retention: "n/a (public weights)", restoreValidation: "llama-server checksum check passes and /health reports ok", rpoHours: null },
];

const CLASSIFICATIONS = new Set(["database", "unique-private", "reprovisionable", "secret"]);

function unsafePath(value) {
  return typeof value !== "string" || value === "" || isAbsolute(value)
    || /^[a-z]:/iu.test(value) || /^(?:\\\\|\/\/)/u.test(value)
    || value.split(/[\\/]/u).includes("..") || value.includes("\0");
}

/** Validate the inventory itself; returns structured issues (empty = valid). */
export function validateDurableInventory(assets = DURABLE_ASSETS) {
  const issues = [];
  const seen = new Set();
  for (const asset of assets) {
    if (!asset?.id || seen.has(asset.id)) issues.push({ code: "duplicate-or-missing-id", detail: String(asset?.id) });
    seen.add(asset?.id);
    if (!CLASSIFICATIONS.has(asset.classification)) issues.push({ code: "unknown-classification", detail: asset.id });
    if (!asset.owner || !asset.retention || !asset.restoreValidation) issues.push({ code: "incomplete-asset", detail: asset.id });
    const declaredPath = String(asset.runtimePath ?? "").replace(/^[a-z-]+:/iu, "");
    if (unsafePath(declaredPath)) issues.push({ code: "unsafe-runtime-path", detail: `${asset.id}:${asset.runtimePath}` });
    if (asset.classification === "unique-private" || asset.classification === "secret") {
      if (!Array.isArray(asset.backup) || !asset.backup.some((method) => /restic/u.test(method)))
        issues.push({ code: "private-not-backed-up", detail: asset.id });
      if (!asset.integrity || !/sha-?256|hash|manifest|perms/iu.test(asset.integrity))
        issues.push({ code: "private-without-integrity", detail: asset.id });
    }
    if (asset.classification === "unique-private" && String(asset.runtimePath ?? "").startsWith("docker-volume:") && !asset.resticVolume)
      issues.push({ code: "private-volume-not-in-restic-set", detail: asset.id });
    if (asset.resticVolume && !(Array.isArray(asset.backup) && asset.backup.some((method) => /restic/u.test(method))))
      issues.push({ code: "incoherent-restic-volume", detail: asset.id });
    if (asset.classification === "reprovisionable") {
      if (!asset.provisioning || !/prepare_[a-z0-9_]+\.py/iu.test(asset.provisioning))
        issues.push({ code: "reprovisionable-without-provisioning", detail: asset.id });
      if (Array.isArray(asset.backup) && asset.backup.some((method) => /restic/u.test(method)))
        issues.push({ code: "public-in-restic-set", detail: asset.id });
    }
  }
  return issues;
}

/**
 * Resolve the private/secret host paths that must be inside the off-host set.
 * Reports every unset or missing required asset so a backup can fail closed.
 */
export function listBackedUpPaths(env = process.env) {
  const paths = [];
  const missing = [];
  for (const asset of DURABLE_ASSETS) {
    if (asset.classification !== "unique-private" && asset.classification !== "secret") continue;
    if (!asset.env) continue; // docker-volume assets are resolved by the host scripts
    const value = env[asset.env];
    if (!value || !existsSync(value)) {
      missing.push({ id: asset.id, env: asset.env });
      continue;
    }
    paths.push(resolve(value));
  }
  return { paths, missing };
}

/** Docker named volumes that ride the off-host restic set directly.
 * `resticVolume: true` marks direct restic content: artwork (unique/private)
 * and the pgbackrest repository (physical backup + WAL). The live `pgdata`
 * volume is deliberately NOT here — its physical coverage reaches restic
 * through the pgbackrest repository, never as a raw live-data copy. */
export function privateVolumes() {
  return DURABLE_ASSETS
    .filter((asset) => asset.resticVolume && String(asset.runtimePath).startsWith("docker-volume:"))
    .map((asset) => String(asset.runtimePath).slice("docker-volume:".length));
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--validate")) {
    const issues = validateDurableInventory(DURABLE_ASSETS);
    if (issues.length) {
      console.error(`Durable inventory invalid: ${issues.length} issue(s)`);
      for (const issue of issues) console.error(`- ${issue.code}: ${issue.detail}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Durable inventory valid: ${DURABLE_ASSETS.length} assets classified.`);
    return;
  }
  if (args.includes("--list-volumes")) {
    for (const volume of privateVolumes()) console.log(volume);
    return;
  }
  if (args.includes("--list-private")) {
    const { paths, missing } = listBackedUpPaths(process.env);
    if (missing.length) {
      console.error(`Missing required durable assets: ${missing.map((entry) => `${entry.id} (${entry.env})`).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    for (const path of paths) console.log(path);
    return;
  }
  console.error("Usage: durable-assets.mjs --validate | --list-private | --list-volumes");
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
