#!/usr/bin/env node
// Evidence bundle (§10A): run the aggregate verifier and retain the proof.
// Captures revision/dirty state, toolchain versions, per-gate commands,
// timestamps, exits/counts and sanitized log hashes into
// docs/audits/releases/<release-id>/. A mandatory gate that is blocked (for
// example the Linux image build on a non-Linux host) blocks the release —
// the bundle records it as BLOCKED, never as passed.
//
//   node scripts/evidence-bundle.mjs [--out docs/audits/releases] [--gates id,id]
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function valueFor(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function run(command, args, { shell = false } = {}) {
  return new Promise((settle) => {
    // Honor the explicit shell flag: git/node/python are real executables and
    // must not go through cmd.exe (which also mangles argument handling);
    // callers pass { shell: true } for .cmd shims such as pnpm.
    const child = spawn(command, args, { cwd: root, shell, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => settle({ code: null, stdout, stderr: String(error) }));
    child.on("close", (code) => settle({ code, stdout, stderr }));
  });
}

const sha256 = (text) => createHash("sha256").update(String(text), "utf8").digest("hex");
const normalize = (text) => text.replace(/\r\n/gu, "\n");

// Git quotes a path in porcelain output when it contains spaces or other
// special characters. The recorded path must be the real path, not the quoted
// form, or every consumer sees a path that does not exist.
const unquotePath = (value) => {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  const escapes = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\" };
  return value
    .slice(1, -1)
    .replace(/\\(.)/gu, (_match, character) => escapes[character] ?? character);
};

async function main() {
  const args = process.argv.slice(2);
  const out = resolve(root, valueFor(args, "--out") ?? "docs/audits/releases");
  const gates = valueFor(args, "--gates");
  const startedAt = new Date();

  const revision = (await run("git", ["rev-parse", "HEAD"], { shell: false })).stdout.trim();
  const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { shell: false })).stdout.trim();
  // No whole-string trim here: porcelain's first line may legitimately start with
  // a space (" M path"), and trimming it would shift the XY columns.
  const porcelain = normalize((await run("git", ["status", "--porcelain"], { shell: false })).stdout);

  // Classify each dirty entry from observed state — never hardcode a narrative.
  // Untracked files are labelled as such; a modified path whose only difference
  // is line endings (git diff --ignore-cr-at-eol is empty) is derived, not assumed.
  // A deleted path is labelled as deleted: it no longer exists on disk, so it
  // must not be counted as modified or read as a surviving file.
  const dirty = [];
  for (const line of porcelain.split("\n").filter((entry) => entry.trim() !== "")) {
    const status = line.slice(0, 2).trim();
    const path = unquotePath(line.slice(3).trim());
    if (status === "??") {
      dirty.push({ status, path, kind: "untracked" });
      continue;
    }
    if (status.includes("D")) {
      dirty.push({ status, path, kind: "deleted" });
      continue;
    }
    const diff = await run("git", ["diff", "--ignore-cr-at-eol", "--quiet", "--", path], { shell: false });
    dirty.push({ status, path, kind: diff.code === 0 ? "line-ending-only" : "content-modified" });
  }

  const verifierArgs = ["scripts/verify-project.mjs", "--json"];
  if (gates) verifierArgs.push("--only", gates);
  const verifier = await run("node", verifierArgs, { shell: false });
  let report = null;
  try {
    report = JSON.parse(verifier.stdout);
  } catch {
    // The verifier prints JSON only; a parse failure means the run itself broke.
  }
  const finishedAt = new Date();

  const tools = await Promise.all([
    run("node", ["--version"], { shell: false }),
    run("pnpm", ["--version"], { shell: true }),
    run("python", ["--version"]),
  ]);
  const kinds = Object.groupBy(dirty, (entry) => entry.kind);
  const dirtyStateNote = dirty.length
    ? `Derived from observed state: ${kinds["line-ending-only"]?.length ?? 0} line-ending-only, ${kinds["content-modified"]?.length ?? 0} content-modified, ${kinds["deleted"]?.length ?? 0} deleted, ${kinds["untracked"]?.length ?? 0} untracked. No claims are made about content beyond this classification.`
    : "clean";
  const releaseId = `${startedAt.toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z")}-${revision.slice(0, 8)}-${dirty.length ? "dirty" : "clean"}`;
  const directory = resolve(out, releaseId);
  await mkdir(directory, { recursive: true });

  const evidence = {
    releaseId,
    generatedAt: finishedAt.toISOString(),
    plan: "EI_POINT_COMPLETION_BUILD_PLAN §10A",
    scope: gates ? `partial gates: ${gates} (not a release verdict)` : "all verifier gates",
    revision,
    branch,
    dirtyState: dirty.length ? dirty : [],
    dirtyStateNote,
    toolchain: {
      node: tools[0].stdout.trim() || tools[0].stderr.trim(),
      pnpm: tools[1].stdout.trim() || tools[1].stderr.trim(),
      python: tools[2].stdout.trim() || tools[2].stderr.trim(),
      pinnedNode: report?.pinned ?? null,
    },
    command: ["node", ...verifierArgs].join(" "),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    verifierExitCode: verifier.code,
    verifierLogSha256: sha256(normalize(verifier.stdout + verifier.stderr)),
    gates: (report?.gates ?? []).map((gate) => ({
      id: gate.id,
      label: gate.label,
      status: gate.status,
      mandatory: gate.mandatory,
      detail: gate.detail,
      detailSha256: sha256(gate.detail),
    })),
    summary: report?.summary ?? null,
    images: {
      status: "blocked",
      note: "Service images build in the Linux CI workflow (images job). Container/OS scanning is not configured on any runner yet and remains BLOCKED — never passed — until a scanner is added (§2B/§10A).",
    },
  };

  await writeFile(resolve(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o644 });

  const lines = [
    `# Evidence bundle ${releaseId}`,
    "",
    `- Captured: ${evidence.generatedAt} (duration ${(evidence.durationMs / 1000).toFixed(1)}s)`,
    `- Revision: \`${revision}\` on \`${branch}\` (${dirty.length ? "dirty" : "clean"} tree)`,
    `- Toolchain: Node ${evidence.toolchain.node}, pnpm ${evidence.toolchain.pnpm}, Python ${evidence.toolchain.python}; pinned Node ${evidence.toolchain.pinnedNode ?? "unknown"}`,
    `- Command: \`${evidence.command}\``,
    `- Verifier exit: ${evidence.verifierExitCode}; verifier log sha256 \`${evidence.verifierLogSha256}\``,
    "",
    "| Gate | Status | Mandatory | Detail |",
    "|---|---|---|---|",
    ...evidence.gates.map((gate) => `| ${gate.id} | ${gate.status.toUpperCase()} | ${gate.mandatory ? "yes" : "recorded"} | ${gate.detail.replace(/\|/gu, "\\|")} |`),
    "",
    evidence.images
      ? `${evidence.images.note}`
      : "",
    "",
    "A BLOCKED or FAILED mandatory gate blocks release. Machine-readable copy: `evidence.json`.",
  ];
  await writeFile(resolve(directory, "README.md"), lines.join("\n") + "\n", { mode: 0o644 });

  console.log(`Evidence bundle written to ${resolve(directory)}`);
  console.log(`Verifier exit code: ${evidence.verifierExitCode}`);
  process.exitCode = evidence.verifierExitCode ?? 1;
}

await main();
