# Security — Aikido code review + scanning

Two layers. Neither is active until you complete the one-time setup below.

## 1. Code review on PRs (Aikido GitHub App)

Per [Connect GitHub Organization](https://help.aikido.dev/code-scanning/connect-your-source-code/connect-github-account-to-aikido.md):

1. Go to <https://app.aikido.dev/> and log in with GitHub (identity + email only).
2. Authorize the organization / `xyanncat/Ei-point` for the Aikido GitHub App.
   Grant only this repository if you prefer — read-only access, code is wiped after analysis.
3. Aikido auto-scans; first results appear in ~1 minute. PR findings then arrive as
   review comments automatically.

## 2. Security scanning in CI (Local Scanner)

Per [GitHub Action Setup](https://help.aikido.dev/code-scanning/local-code-scanning/github-action-setup-for-local-code-scanning.md):

1. Create a Local Scanning account, then generate a token at
   `app.aikido.dev → Settings → Integrations → Local Scanner` (shown once).
2. Add it as repo secret `AIKIDO_API_KEY` (Settings → Secrets and variables → Actions).
3. Push to `main` (or run the workflow manually). `.github/workflows/aikido-scan.yml`
   scans SAST + dependencies + IaC + secrets locally and uploads only results to Aikido,
   filed under repository name `Ei-point`, branch `main`.

The workflow is non-blocking by design until the first baseline is triaged.
Release/PR gating (fail on open issues ≥ severity) is the follow-up once triage is clean.

## 3. Local scans via Aikido MCP (developer workstation)

The `aikido` MCP server is registered in `~/.config/opencode/opencode.jsonc`
(`npx -y @aikidosec/mcp@latest`). It exposes `aikido_scan_paths` — a local
SAST/secrets/IaC scan of files on disk, usable as the per-phase audit step.

Known limitation (verified 2026-10-10): on this Windows workstation the bundled
SAST (Opengrep) and IaC (Checkov) engines fail to execute, so a local MCP scan
currently proves secrets-clean only. Full SAST/IaC coverage comes from the CI
scanner (§2, needs `AIKIDO_API_KEY`) or a VPS-side run. Re-verify engine health
before relying on MCP scans for a phase gate.

## Secret hygiene (enforced now, audited per phase)

- Real secrets live only in `.env` (gitignored, never committed) and the VPS vault.
  Verified: `git ls-files` contains no `.env`; repo holds placeholders (`CHANGE_ME_*`) only.
- Access tokens (Discord OAuth) are never stored in cookies or the DB — only signed user ids.
- New code must pass the per-phase audit with 0 critical / 0 major security findings.
