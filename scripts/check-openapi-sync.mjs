#!/usr/bin/env node
// API/schema compatibility (§10A): regenerate the dashboard API contract from
// apps/api/src/openapi.json and fail when the checked-in contract would change
// (ignoring line-ending-only differences). The working file is always restored.
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = resolve(root, "packages/contracts/src/dashboard-api.ts");
const normalize = (text) => text.replace(/\r\n/gu, "\n");

function generate() {
  return new Promise((settle) => {
    const child = process.platform === "win32"
      ? spawn("pnpm generate:dashboard-api", { cwd: root, shell: true, windowsHide: true })
      : spawn("pnpm", ["generate:dashboard-api"], { cwd: root, windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => settle({ ok: false, stderr: String(error) }));
    child.on("close", (code) => settle({ ok: code === 0, stderr }));
  });
}

async function main() {
  const before = await readFile(contract, "utf8");
  try {
    const result = await generate();
    if (!result.ok) {
      console.error(`openapi-typescript generation failed: ${result.stderr}`);
      process.exitCode = 1;
      return;
    }
    const after = await readFile(contract, "utf8");
    if (normalize(before) !== normalize(after)) {
      console.error("Dashboard API contract is out of sync with apps/api/src/openapi.json; run pnpm generate:dashboard-api and commit the result.");
      process.exitCode = 1;
      return;
    }
    console.log("Dashboard API contract matches apps/api/src/openapi.json (content compared, line endings ignored).");
  } finally {
    await writeFile(contract, before);
  }
}

await main();
