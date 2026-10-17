import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../apps/services/hy-mt2/start-model.sh", import.meta.url));
const MODEL_NAME = "Hy-MT2-1.8B-Q4_K_M.gguf";
const BASH = ["bash", "C:/Program Files/Git/usr/bin/bash.exe", "C:/Program Files/Git/bin/bash.exe"].find(candidate => {
  try { return spawnSync(candidate, ["-c", "exit 0"], { windowsHide: true }).status === 0; } catch { return false; }
});

const GIT_USR_BIN = "C:\\Program Files\\Git\\usr\\bin";

function run(dir) {
  const result = spawnSync(BASH, [script], {
    cwd: dir, encoding: "utf8", windowsHide: true,
    env: { ...process.env, PATH: `${GIT_USR_BIN};${process.env.PATH}`, MODEL_DIR: ".", MODEL_NAME, MODEL_EXEC: "true" },
  });
  return { status: result.status, stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
}
function fixture({ model = "valid model bytes", manifestModel = MODEL_NAME, manifestHash = null, extraLine = null, traverse = false }) {
  const dir = mkdtempSync(join(tmpdir(), "ei-hymt2-"));
  writeFileSync(join(dir, MODEL_NAME), model);
  const hash = manifestHash ?? createHash("sha256").update(model).digest("hex");
  const name = traverse ? "../evil.gguf" : manifestModel;
  writeFileSync(join(dir, "ei-point-model.sha256"), `${hash}  ${name}\n${extraLine ? `${"a".repeat(64)}  ${extraLine}\n` : ""}`);
  return dir;
}

test("model integrity checks require bash on this host", () => {
  assert.ok(BASH, "Git Bash is required to run the hermetic model-integrity checks");
});

test("valid pinned asset starts the model", () => {
  const dir = fixture({});
  try {
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unrelated-only manifest cannot satisfy verification", () => {
  const dir = fixture({ manifestModel: "some-other-file.gguf", manifestHash: createHash("sha256").update("other").digest("hex") });
  try {
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pin exactly the served/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("traversal entries are rejected", () => {
  const dir = fixture({ traverse: true });
  try {
    const result = run(dir);
    assert.equal(result.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a swapped model filename is rejected", () => {
  const dir = fixture({ manifestModel: "Hy-MT2-1.8B-Q8_0.gguf" });
  try {
    const result = run(dir);
    assert.equal(result.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a multi-entry manifest is rejected", () => {
  const dir = fixture({ extraLine: "another.gguf" });
  try {
    const result = run(dir);
    assert.equal(result.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("corrupted model bytes fail the checksum", () => {
  const dir = fixture({});
  writeFileSync(join(dir, MODEL_NAME), "tampered bytes");
  try {
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAILED|checksum/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing model file is rejected before any execution", () => {
  const dir = mkdtempSync(join(tmpdir(), "ei-hymt2-"));
  writeFileSync(join(dir, "ei-point-model.sha256"), `${"a".repeat(64)}  ${MODEL_NAME}\n`);
  try {
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The upstream llama.cpp image loads its shared libraries relative to the
// process working directory; the model exec must therefore run from the
// directory the entrypoint was started in, not from the read-only model mount.
test("the model exec starts from the original working directory", () => {
  const dir = fixture({});
  const workdir = mkdtempSync(join(tmpdir(), "ei-hymt2-cwd-"));
  const out = join(workdir, "exec-cwd.txt").replace(/\\/g, "/");
  try {
    const result = spawnSync(BASH, [script, "-c", `pwd > "${out}"`], {
      cwd: workdir, encoding: "utf8", windowsHide: true,
      env: { ...process.env, PATH: `${GIT_USR_BIN};${process.env.PATH}`, MODEL_DIR: dir.replace(/\\/g, "/"), MODEL_NAME, MODEL_EXEC: BASH },
    });
    assert.equal(result.status, 0, result.stderr);
    const expected = spawnSync(BASH, ["-c", "pwd"], { cwd: workdir, encoding: "utf8", windowsHide: true });
    assert.equal(readFileSync(out, "utf8").trim(), expected.stdout.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
  }
});
