#!/usr/bin/env node
// Reproducible verification entrypoint (§2B / §10A). Aggregates the required
// gates with SEPARATE results. A gate whose mandatory tool is unavailable is
// BLOCKED, never passed. Exit codes: 0 satisfied, 1 a mandatory gate failed,
// 2 a mandatory gate is blocked.
//
//   node scripts/verify-project.mjs                 # every gate
//   node scripts/verify-project.mjs --only id,id    # partial run (not a verdict)
//   node scripts/verify-project.mjs --skip id       # omit a gate
//   node scripts/verify-project.mjs --json          # machine-readable report
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Read the pinned Node runtime version from `.nvmrc`. */
export async function readNvmrc(base = root) {
  return (await readFile(resolve(base, ".nvmrc"), "utf8")).trim();
}

/** The gate plan is data: the same list drives CI and local runs. */
export function gatePlan(pinned) {
  return [
    { id: "node-runtime", label: "pinned Node runtime (.nvmrc)", kind: "runtime", mandatory: true, pinned },
    { id: "pnpm-toolchain", label: "pnpm toolchain", command: "pnpm", args: ["--version"], mandatory: true, tool: "pnpm", expectStdout: /^9\./ },
    { id: "python-music", label: "music bot unit tests", command: "python", args: ["-m", "unittest", "discover", "-s", "apps/bots/music-py/tests", "-p", "test_*.py"], mandatory: true, tool: "python" },
    { id: "python-qwen", label: "qwen TTS service unit tests", command: "python", args: ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], cwd: "apps/services/qwen-tts", mandatory: true, tool: "python" },
    { id: "feature-coverage", label: "legacy feature coverage (structural)", command: "node", args: ["scripts/check-feature-coverage.mjs", "--mode", "structural"], mandatory: true },
    // §10A: strict release coverage. The legacy map is fully reconciled
    // (86 verified + 93 approved replacements) and this gate passes; it is
    // mandatory so a regression in the map blocks the release verdict.
    { id: "feature-coverage-release", label: "legacy feature coverage (release mode)", command: "node", args: ["scripts/check-feature-coverage.mjs", "--mode", "release"], mandatory: true },
    { id: "openapi-sync", label: "dashboard API contract sync", command: "node", args: ["scripts/check-openapi-sync.mjs"], mandatory: true },
    { id: "root-suites", label: "root suites + phase gates + resource budget", command: "pnpm", args: ["test"], mandatory: true, timeoutMs: 1_500_000 },
    { id: "typecheck", label: "workspace typecheck", command: "pnpm", args: ["typecheck"], mandatory: true, timeoutMs: 1_500_000 },
    { id: "browser", label: "browser acceptance", command: "pnpm", args: ["test:browser"], mandatory: true, timeoutMs: 1_800_000 },
    { id: "npm-audit", label: "npm production advisories (recorded, triaged)", command: "pnpm", args: ["audit", "--prod", "--json"], mandatory: false },
    { id: "python-audit", label: "python dependency advisories (recorded, triaged)", command: "python", args: ["-m", "pip_audit", "-r", "apps/bots/music-py/requirements.txt"], mandatory: false, tool: "python" },
    { id: "container-scan", label: "container/OS image scan", kind: "external", mandatory: false },  ];
}

function result(gate, status, detail) {
  return { id: gate.id, label: gate.label, status, mandatory: Boolean(gate.mandatory), detail };
}

function tail(text, lines = 8) {
  const all = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return all.slice(-lines).join(" | ");
}

export function spawnCapture(command, args, { cwd, timeoutMs = 600_000 } = {}) {
  return new Promise((settle) => {
    const useShell = process.platform === "win32";
    const quote = (value) => (/[\s"]/u.test(value) ? `"${String(value).replace(/"/gu, '\\"')}"` : value);
    const start = () => {
      const child = useShell
        ? spawn([command, ...args].map(quote).join(" "), { cwd, shell: true, windowsHide: true })
        : spawn(command, args, { cwd, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let timer;
      const finish = (value) => {
        if (timer) clearTimeout(timer);
        settle(value);
      };
      child.on("error", (error) => finish({ code: null, stdout, stderr, missing: error.code === "ENOENT", error }));
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          try { child.kill(); } catch { /* already gone */ }
          finish({ code: null, stdout, stderr, error: new Error(`timed out after ${timeoutMs}ms`) });
        }, timeoutMs);
      }
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => finish({ code, stdout, stderr, missing: useShell && (code === 9009 || code === 127) }));
    };
    if (!useShell) {
      start();
      return;
    }
    // Windows shell mode: probe availability first. Which exit code a missing
    // command produces depends on ComSpec (9009 under cmd.exe, 1 under others),
    // so `where` is the deterministic check; a failed probe classifies the gate
    // as blocked instead of failed.
    const probe = spawn("where", [command], { windowsHide: true });
    probe.on("error", () => settle({ code: null, stdout: "", stderr: "", missing: true }));
    probe.on("close", (code) => {
      if (code !== 0) settle({ code: null, stdout: "", stderr: "", missing: true });
      else start();
    });
  });
}

/** Run one gate. `exec` is injectable so the contract is testable without subprocesses. */
export async function runGate(gate, ctx = {}) {
  if (gate.kind === "runtime") {
    const pinned = gate.pinned ?? (await readNvmrc(ctx.root ?? root));
    const actual = process.version.replace(/^v/, "");
    const major = (version) => String(version).split(".")[0];
    if (major(actual) !== major(pinned)) {
      return result(gate, "failed", `expected Node ${pinned}, running ${actual}`);
    }
    if (actual !== pinned) {
      return result(gate, "passed", `running ${actual}; pinned ${pinned} (same major; CI uses setup-node .nvmrc)`);
    }
    return result(gate, "passed", `running ${actual}; pinned ${pinned}`);
  }
  if (gate.kind === "external" || !gate.command) {
    return result(gate, "blocked", "no runner on this host; the service images build in the Linux CI workflow (images job), but no container/OS scanner is configured yet");
  }
  const exec = ctx.exec ?? spawnCapture;
  let outcome;
  try {
    outcome = await exec(gate.command, gate.args ?? [], { cwd: gate.cwd ? resolve(root, gate.cwd) : (ctx.root ?? root), timeoutMs: gate.timeoutMs });
  } catch (error) {
    if (gate.tool && error?.code === "ENOENT") return result(gate, "blocked", `${gate.tool} is not installed`);
    return result(gate, "failed", error?.message ?? String(error));
  }
  const output = `${outcome.stdout ?? ""}${outcome.stderr ?? ""}`.trim();
  if (outcome.missing && gate.tool) return result(gate, "blocked", `${gate.tool} is not installed`);
  if (outcome.code === 0) {
    if (gate.expectStdout && !gate.expectStdout.test(String(outcome.stdout ?? "").trim())) {
      return result(gate, "failed", `unexpected output: ${tail(output)}`);
    }
    return result(gate, "passed", tail(output) || "exit 0");
  }
  return result(gate, "failed", `exit ${outcome.code}: ${tail(output)}`);
}

/** Aggregate separate gate results; a blocked mandatory gate is not a pass. */
export function summarize(results) {
  const failed = results.filter((entry) => entry.status === "failed");
  const blocked = results.filter((entry) => entry.status === "blocked");
  const exitCode = failed.some((entry) => entry.mandatory) ? 1 : blocked.some((entry) => entry.mandatory) ? 2 : 0;
  return {
    ok: exitCode === 0,
    exitCode,
    passed: results.filter((entry) => entry.status === "passed").length,
    failed,
    blocked,
  };
}

function valueFor(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const only = valueFor(args, "--only")?.split(",").map((entry) => entry.trim()).filter(Boolean);
  const skip = new Set(valueFor(args, "--skip")?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? []);
  const json = args.includes("--json");
  const pinned = await readNvmrc(root);
  const plan = gatePlan(pinned);
  const known = new Set(plan.map((gate) => gate.id));
  const requested = [...(only ?? []), ...skip];
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length) {
    console.error(`Unknown gate id(s): ${unknown.join(", ")}; known: ${[...known].join(", ")}`);
    process.exitCode = 2;
    return;
  }
  const gates = plan.filter(
    (gate) => (only ? only.includes(gate.id) : true) && !skip.has(gate.id),
  );
  const results = [];
  for (const gate of gates) {
    const outcome = await runGate(gate);
    results.push(outcome);
    if (!json) console.log(`${outcome.status.toUpperCase().padEnd(7)} ${outcome.id}: ${outcome.detail}`);
  }
  const summary = summarize(results);
  const partial = Boolean(only) || skip.size > 0;
  if (json) {
    console.log(JSON.stringify({ pinned, partial, gates: results, summary }, null, 2));
  } else {
    console.log(
      `\n${summary.passed} passed, ${summary.failed.length} failed, ${summary.blocked.length} blocked` +
        (partial ? " — PARTIAL run (not a release verdict)" : ""),
    );
  }
  process.exitCode = summary.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
