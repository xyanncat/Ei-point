#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const kinds = new Set(["command", "component", "event", "route", "scheduled job", "asset flow"]);
const statuses = new Set(["verified", "implemented-unverified", "missing", "replaced", "decision-required"]);
const required = ["id", "archive", "sourcePath", "sourceSymbol", "kind", "expectedBehavior", "targetPaths", "testReferences", "status", "decisionReason"];

function safeWorkspacePath(value, workspace = root) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)
    || /^[a-z]:/iu.test(value) || /^(?:\\\\|\/\/)/u.test(value)
    || value.split(/[\\/]/u).includes("..") || value.includes("\0")) return false;
  const destination = relative(workspace, resolve(workspace, value));
  return destination.length > 0 && destination !== ".." && !destination.startsWith(`..${sep}`) && !isAbsolute(destination);
}

export function validateFeatureCoverage(document, options = {}) {
  const mode = options.mode === "release" ? "release" : "structural";
  const workspace = resolve(options.root ?? root);
  const realWorkspace = realpathSync(workspace);
  const fileExists = options.fileExists ?? (path => {
    try {
      const actual = realpathSync(resolve(workspace, path));
      const destination = relative(realWorkspace, actual);
      return destination.length > 0 && destination !== ".." && !destination.startsWith(`..${sep}`) && !isAbsolute(destination);
    } catch {
      return false;
    }
  });
  const issues = [];
  const issue = (code, detail) => issues.push({ code, detail });

  if (!document || typeof document !== "object" || document.schemaVersion !== 1 || !Array.isArray(document.rows)) {
    return [{ code: "malformed-document", detail: "Expected { schemaVersion: 1, rows: [...] }." }];
  }

  let sourceIndex = options.sourceIndex ?? null;
  if (document.sourceInventory !== undefined) {
    if (!safeWorkspacePath(document.sourceInventory) || !fileExists(document.sourceInventory)) {
      issue("missing-source-inventory", `Source inventory does not exist: ${String(document.sourceInventory)}.`);
    } else if (!sourceIndex) {
      try {
        sourceIndex = JSON.parse(readFileSync(resolve(workspace, document.sourceInventory), "utf8"));
      } catch (error) {
        issue("malformed-source-inventory", `Cannot read ${document.sourceInventory}: ${error.message}`);
      }
    }
  }

  const ids = new Set();
  for (const [index, row] of document.rows.entries()) {
    const label = row?.id || `row ${index + 1}`;
    if (!row || typeof row !== "object" || required.some(key => !(key in row))
      || typeof row.id !== "string" || !row.id.trim()
      || typeof row.archive !== "string" || !row.archive.trim()
      || typeof row.sourcePath !== "string" || !safeWorkspacePath(row.sourcePath, workspace)
      || typeof row.sourceSymbol !== "string" || !row.sourceSymbol.trim()
      || !kinds.has(row.kind)
      || typeof row.expectedBehavior !== "string" || row.expectedBehavior.trim().length < 12
      || !Array.isArray(row.targetPaths) || !Array.isArray(row.testReferences)
      || !statuses.has(row.status)
      || typeof row.decisionReason !== "string") {
      issue("malformed-row", `${label}: one or more required fields are invalid.`);
      continue;
    }

    if (ids.has(row.id)) issue("duplicate-id", `${row.id}: IDs must be unique.`);
    ids.add(row.id);

    if (row.status === "missing" || row.status === "decision-required") {
      issue("unresolved-mapping", `${row.id}: status is ${row.status}.`);
    }
    if (row.targetPaths.length === 0 || row.testReferences.length === 0) {
      issue("unresolved-mapping", `${row.id}: a target handler and acceptance test reference are required.`);
    }

    if (sourceIndex && !sourceRowExists(sourceIndex, row)) {
      issue("unresolved-source", `${row.id}: source archive, file and symbol do not match the recorded inventory.`);
    }

    for (const path of [...row.targetPaths, ...row.testReferences]) {
      if (!safeWorkspacePath(path, workspace) || !fileExists(path)) {
        issue("missing-reference", `${row.id}: workspace reference does not exist: ${String(path)}.`);
      }
    }

    if (row.status === "replaced") {
      const match = /^approved:\s*(.+)$/iu.exec(row.decisionReason.trim());
      if (!match || !safeWorkspacePath(match[1], workspace) || !fileExists(match[1])) {
        issue("replacement-without-decision", `${row.id}: decisionReason must name an existing approved decision record as "approved: path".`);
      }
    }

    if (mode === "release") {
      // Release coverage accepts only fully verified behavior or approved replacements
      // with a reachable acceptance test; structural completeness is not enough.
      if (row.status !== "verified" && row.status !== "replaced") {
        issue("release-unverified-row", `${row.id}: status ${row.status} is not release-ready (verified or approved replacement required).`);
      }
      if (row.status === "verified" && row.decisionReason.trim().length < 12) {
        issue("release-missing-evidence", `${row.id}: verified rows must carry an evidence note in decisionReason.`);
      }
    }
  }

  return issues;
}

function sourceRowExists(sourceIndex, row) {
  if (!Array.isArray(sourceIndex?.archives)) return false;
  const archive = sourceIndex.archives.find(entry => entry.archive === row.archive);
  const file = archive?.files?.find(entry => entry.path === row.sourcePath);
  return Boolean(file?.symbols?.some(symbol => symbol.name === row.sourceSymbol
    && (row.parentCommand === undefined || symbol.parent_command === row.parentCommand)
    && (row.sourceLine === undefined || symbol.line === row.sourceLine)));
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : "structural";
  if (mode !== "structural" && mode !== "release") {
    console.error('Usage: check-feature-coverage.mjs [map.json] [--mode structural|release]');
    process.exitCode = 2;
    return;
  }
  const fileArg = args.find((arg, index) => !arg.startsWith("-") && (modeIndex === -1 || index !== modeIndex + 1));
  const file = fileArg ? resolve(fileArg) : resolve(root, "docs/audits/legacy-behavior-map.json");
  let document;
  try {
    document = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    console.error(`Cannot read feature map ${file}: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const issues = validateFeatureCoverage(document, { mode });
  if (issues.length) {
    const counts = Object.groupBy(issues, entry => entry.code);
    console.error(`Feature coverage check failed (${mode} mode): ${issues.length} issue(s) across ${document.rows.length} rows.`);
    for (const [code, entries] of Object.entries(counts)) console.error(`- ${code}: ${entries.length}`);
    for (const entry of issues.slice(0, 12)) console.error(`  ${entry.code}: ${entry.detail}`);
    if (issues.length > 12) console.error(`  ... ${issues.length - 12} more; inspect the JSON map for row-level status.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Feature coverage structure is valid (${mode} mode): ${document.rows.length} rows; all rows map to existing targets and tests.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
