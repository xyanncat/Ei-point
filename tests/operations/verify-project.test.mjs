import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
    "feature-coverage",
    "openapi-sync",
    "root-suites",
    "typecheck",
    "browser",
  ])
    assert.ok(mandatory.includes(required), `${required} must be a mandatory gate`);
  // Scans are recorded/triaged, not release-blocking (§10A wording).
  for (const recorded of ["npm-audit", "python-audit", "container-scan"])
    assert.ok(!mandatory.includes(recorded), `${recorded} must be recorded, not mandatory`);
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
  for (const command of ["pnpm test", "pnpm typecheck", "test:browser", "check-feature-coverage.mjs", "unittest discover"])
    assert.ok(yaml.includes(command), `workflow must run: ${command}`);
});
