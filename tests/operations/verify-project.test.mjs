import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gatePlan, summarize, runGate, readNvmrc } from "../../scripts/verify-project.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("the gate plan keeps required and recorded gates distinct", () => {
  const plan = gatePlan("24.8.0");
  const mandatory = plan.filter((gate) => gate.mandatory).map((gate) => gate.id);
  // §10A: pinned Node/checker/Python, coverage, build/typecheck, scans and browser.
  for (const required of [
    "node-runtime",
    "pnpm-toolchain",
    "python-music",
    "python-qwen",
    "feature-coverage",
    "feature-coverage-release",
    "openapi-sync",
    "root-suites",
    "typecheck",
    "browser",
  ])
    assert.ok(mandatory.includes(required), `${required} must be a mandatory gate`);
  // Scans are recorded/triaged, not release-blocking (§10A wording).
  for (const recorded of ["npm-audit", "python-audit", "container-scan"])
    assert.ok(!mandatory.includes(recorded), `${recorded} must be recorded, not mandatory`);
  assert.ok(plan.some((gate) => gate.id === "feature-coverage-release" && gate.args?.includes("release")), "strict coverage must be a mandatory gate");
});

test("a blocked mandatory gate is not a pass; exit codes separate fail from blocked", () => {
  const passed = { id: "a", mandatory: true, status: "passed" };
  const failed = { id: "b", mandatory: true, status: "failed" };
  const blocked = { id: "c", mandatory: true, status: "blocked" };
  const optionalBlocked = { id: "d", mandatory: false, status: "blocked" };
  assert.equal(summarize([passed]).exitCode, 0);
  assert.equal(summarize([passed, optionalBlocked]).exitCode, 0);
  assert.equal(summarize([passed, failed]).exitCode, 1);
  assert.equal(summarize([passed, blocked]).exitCode, 2);
  assert.equal(summarize([passed, blocked]).ok, false);
});

test("an unavailable mandatory tool is blocked, while a present tool's failure is a failure", async () => {
  const python = gatePlan("24.8.0").find((gate) => gate.id === "python-music");
  const missing = await runGate(python, { exec: async () => { const error = new Error("nope"); error.code = "ENOENT"; throw error; } });
  assert.equal(missing.status, "blocked");
  const present = await runGate(python, { exec: async () => ({ code: 1, stdout: "", stderr: "boom" }) });
  assert.equal(present.status, "failed");
  const external = await runGate(gatePlan("24.8.0").find((gate) => gate.id === "container-scan"));
  assert.equal(external.status, "blocked");
});

test("a genuinely missing executable is blocked through the real spawner (shell 9009/127 or ENOENT)", async () => {
  const gate = { id: "missing-tool", label: "absent tool", command: "ei-point-definitely-missing-tool-xyz", args: [], mandatory: true, tool: "ei-point-definitely-missing-tool-xyz" };
  const outcome = await runGate(gate); // no injected exec: exercises spawnCapture
  assert.equal(outcome.status, "blocked", outcome.detail);
  assert.match(outcome.detail, /not installed/);
});

test("the pinned runtime gate reads .nvmrc and compares the major version", async () => {
  assert.equal(await readNvmrc(repo), "24.8.0");
  const gate = gatePlan("24.8.0").find((entry) => entry.id === "node-runtime");
  const outcome = await runGate(gate);
  // Local Node may be a different patch (24.21.0); the major must match the pin.
  assert.equal(outcome.status, "passed");
  const wrongMajor = await runGate({ ...gate, pinned: "20.11.0" });
  assert.equal(wrongMajor.status, "failed");
});

test("the CI workflow exists and runs every mandatory gate with a frozen lockfile", () => {
  const workflow = fileURLToPath(new URL("../../.github/workflows/verify.yml", import.meta.url));
  assert.ok(existsSync(workflow), "CI workflow must be checked in (A20)");
  const yaml = readFileSync(workflow, "utf8");
  assert.match(yaml, /node-version-file:\s*\.nvmrc/);
  assert.match(yaml, /pnpm install --frozen-lockfile/);
  for (const command of ["pnpm test", "pnpm typecheck", "pnpm lint", "pnpm build", "test:browser", "check-feature-coverage.mjs", "check-openapi-sync.mjs", "unittest discover"])
    assert.ok(yaml.includes(command), `workflow must run: ${command}`);
  // §2B: locked immutable images must build in Linux CI.
  assert.match(yaml, /docker compose -f infra\/docker\/compose\.yml build --pull/);
  assert.match(yaml, /docker compose -f infra\/docker\/compose\.yml config --quiet/);
});

test("the evidence bundle classifies dirty state from observed paths that exist", async () => {
  const { mkdtemp, readdir, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const out = await mkdtemp(join(tmpdir(), "ei-bundle-test-"));
  const run = spawnSync(process.execPath, ["scripts/evidence-bundle.mjs", "--out", out, "--gates", "node-runtime"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const bundleDir = (await readdir(out))[0];
  const evidence = JSON.parse(await readFile(join(out, bundleDir, "evidence.json"), "utf8"));
  assert.ok(Array.isArray(evidence.dirtyState), "dirtyState must be an array");
  // A porcelain parsing bug once ate the leading "." of the first entry's path;
  // every classified path must exist on disk exactly as recorded.
  for (const entry of evidence.dirtyState) {
    assert.ok(existsSync(entry.path), `dirty path must exist on disk: ${entry.path}`);
    assert.ok(["untracked", "line-ending-only", "content-modified"].includes(entry.kind), `unexpected kind: ${entry.kind}`);
  }
  assert.match(evidence.dirtyStateNote, /Derived from observed state|^clean$/);
  assert.equal(evidence.verifierExitCode, 0);
  await rm(out, { recursive: true, force: true });
});

test("the CLI rejects unknown gate ids instead of selecting zero gates and exiting 0", () => {
  const bad = spawnSync(process.execPath, ["scripts/verify-project.mjs", "--only", "no-such-gate"], { encoding: "utf8" });
  assert.equal(bad.status, 2, bad.stderr);
  assert.match(bad.stderr, /Unknown gate id/);
  const skipped = spawnSync(process.execPath, ["scripts/verify-project.mjs", "--skip", "not-a-gate"], { encoding: "utf8" });
  assert.equal(skipped.status, 2, skipped.stderr);
});
