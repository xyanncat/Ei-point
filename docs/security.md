# Security — self-audit mode (Aikido removed 2026-10-10)

Aikido (CI scanner, GitHub App, MCP server) was evaluated and fully removed:
its local SAST/IaC engines could not execute reliably on this workstation, its
platform calls hung, and the issued API key was rejected as rotated/revoked.
No Aikido configuration, secret, workflow, or MCP registration remains
(`gh secret list` empty, no `.github/workflows`, no MCP block in opencode config).

## Current gates (per phase, on `main`, single-branch)

1. Implement the phase scope.
2. Self-verify: isolated `tsc --noEmit`, `node --test`, YAML/SQL parse checks.
3. Self-review: full re-read of every touched file; fix all findings.
4. Repoisitory secret audit: repo holds placeholders (`CHANGE_ME_*`) only —
   real secrets live in `.env` (gitignored) and the VPS vault. Verified per phase
   with pattern grep (tokens, private keys, cloud credentials).
5. Push only on 0 critical / 0 major findings.

Full-stack checks that need the VPS (live DB routes, `next build`, image boot,
restore drills) are tracked as VPS gates in `docs/phase-gates.md`, never assumed.

## Secret hygiene (enforced, audited per phase)

- Real secrets live only in `.env` (gitignored, never committed) and the VPS vault.
- Access tokens (Discord OAuth) are never stored in cookies or the DB — only signed user ids.
- Log detail passes through credential redaction (`packages/modules/logging`).
- Revisit managed scanning (Aikido or equivalent) before main-guild cutover (§10).
