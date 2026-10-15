import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { validateFeatureCoverage } from "../scripts/check-feature-coverage.mjs";

const row = (overrides = {}) => ({
  id: "legacy:one",
  archive: "source.zip",
  sourcePath: "source/one.ts",
  sourceSymbol: "/one",
  kind: "command",
  expectedBehavior: "A concrete behavior statement.",
  targetPaths: ["apps/api/src/app.ts"],
  testReferences: ["tests/phase4/commerce.test.mjs"],
  status: "implemented-unverified",
  decisionReason: "",
  ...overrides,
});

const map = rows => ({ schemaVersion: 1, rows });

test("accepts a complete source-to-target-to-test row without claiming semantic verification", () => {
  assert.deepEqual(validateFeatureCoverage(map([row()])), []);
});

test("rejects duplicate mapping IDs", () => {
  const issues = validateFeatureCoverage(map([row(), row({ sourceSymbol: "/two" })]));
  assert.ok(issues.some(issue => issue.code === "duplicate-id"));
});

test("rejects unresolved behavior rows", () => {
  const issues = validateFeatureCoverage(map([row({ status: "decision-required", targetPaths: [], testReferences: [] })]));
  assert.ok(issues.some(issue => issue.code === "unresolved-mapping"));
});

test("rejects references that do not exist in the workspace", () => {
  const issues = validateFeatureCoverage(map([row({ targetPaths: ["apps/missing/handler.ts"] })]));
  assert.ok(issues.some(issue => issue.code === "missing-reference"));
});

test("requires an acceptance test reference for each mapped behavior", () => {
  const issues = validateFeatureCoverage(map([row({ testReferences: [] })]));
  assert.ok(issues.some(issue => issue.code === "unresolved-mapping" && issue.detail.includes("acceptance test")));
});

test("rejects acceptance test paths that do not exist", () => {
  const issues = validateFeatureCoverage(map([row({ testReferences: ["tests/missing.test.mjs"] })]));
  assert.ok(issues.some(issue => issue.code === "missing-reference" && issue.detail.includes("tests/missing.test.mjs")));
});

test("requires an approved decision reference for replacements", () => {
  const issues = validateFeatureCoverage(map([row({ status: "replaced", decisionReason: "Changed behavior." })]));
  assert.ok(issues.some(issue => issue.code === "replacement-without-decision"));
});

test("rejects absolute and traversal references outside the workspace", () => {
  const issues = validateFeatureCoverage(map([row({ targetPaths: ["../outside/handler.ts"] })]));
  assert.ok(issues.some(issue => issue.code === "missing-reference"));
});

test("rejects drive-relative Windows paths even when the path probe reports a hit", () => {
  const issues = validateFeatureCoverage(map([row({ targetPaths: ["C:outside.ts"] })]), { fileExists: () => true });
  assert.ok(issues.some(issue => issue.code === "missing-reference"));
});

test("rejects malformed rows and unknown statuses", () => {
  const issues = validateFeatureCoverage(map([row({ status: "verified-ish", sourceSymbol: "" })]));
  assert.ok(issues.some(issue => issue.code === "malformed-row"));
});

test("checks that each source path and symbol exists in the hashed archive inventory", () => {
  const sourceIndex = { archives: [{ archive: "source.zip", files: [{ path: "source/one.ts", symbols: [{ name: "/one", line: 1 }] }] }] };
  const issues = validateFeatureCoverage(map([row({ sourceLine: 2 })]), { sourceIndex });
  assert.ok(issues.some(issue => issue.code === "unresolved-source"));
});

test("archive parser records command descriptions and non-command capability declarations", () => {
  const input = JSON.stringify({
    path: "legacy/routes.ts",
    text: `
      const command = new SlashCommandBuilder().setName("health").setDescription("Show service health");
      app.post("/api/orders", createOrder);
      client.on("guildMemberAdd", onJoin);
      new ButtonBuilder().setCustomId("confirm-order");
      cron.schedule("0 * * * *", cleanup);
    `,
  });
  const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/inventory-archives.mjs"), "--symbols"], {
    input: `${input}\n`, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim());
  assert.ok(parsed.symbols.some(symbol => symbol.kind === "slash-command" && symbol.description === "Show service health"));
  assert.ok(parsed.symbols.some(symbol => symbol.kind === "route" && symbol.name === "POST /api/orders"));
  assert.ok(parsed.symbols.some(symbol => symbol.kind === "event" && symbol.name === "guildMemberAdd"));
  assert.ok(parsed.symbols.some(symbol => symbol.kind === "component" && symbol.name === "confirm-order"));
  assert.ok(parsed.symbols.some(symbol => symbol.kind === "scheduled job"));
});

test("release mode rejects implemented-unverified rows", () => {
  const issues = validateFeatureCoverage(map([row()]), { mode: "release" });
  assert.ok(issues.some(issue => issue.code === "release-unverified-row"));
});
test("release mode rejects missing evidence notes for verified rows", () => {
  const issues = validateFeatureCoverage(map([row({ status: "verified", decisionReason: "" })]), { mode: "release" });
  assert.ok(issues.some(issue => issue.code === "release-missing-evidence"));
});
test("release mode accepts a verified row carrying an evidence note", () => {
  const issues = validateFeatureCoverage(map([row({ status: "verified", decisionReason: "Trace: handler plus named regression test." })]), { mode: "release" });
  assert.deepEqual(issues, []);
});
test("release mode requires replacements to keep an approved decision and a reachable test", () => {
  const decision = "approved: docs/product/bot-command-and-runtime-spec.md";
  assert.deepEqual(validateFeatureCoverage(map([row({ status: "replaced", decisionReason: decision })]), { mode: "release" }), []);
  const withoutTest = validateFeatureCoverage(map([row({ status: "replaced", decisionReason: decision, testReferences: [] })]), { mode: "release" });
  assert.ok(withoutTest.some(issue => issue.code === "unresolved-mapping"));
  const withoutDecision = validateFeatureCoverage(map([row({ status: "replaced", decisionReason: "we felt like it" })]), { mode: "release" });
  assert.ok(withoutDecision.some(issue => issue.code === "replacement-without-decision"));
});
test("CLI validates a positional map file and honors --mode release", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "ei-map-cli-"));
  try {
    const goodPath = join(dir, "good.json");
    await writeFile(goodPath, JSON.stringify(map([row()])));
    const ok = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-feature-coverage.mjs"), goodPath], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /structural mode/);
    const missing = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-feature-coverage.mjs"), join(dir, "absent.json")], { encoding: "utf8" });
    assert.equal(missing.status, 2);
    const release = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-feature-coverage.mjs"), goodPath, "--mode", "release"], { encoding: "utf8" });
    assert.equal(release.status, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
