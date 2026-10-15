# Foundation acceptance evidence

**Status:** Local Windows checks pass; Phase 2 acceptance remains open.

**Recorded:** 2026-10-15
**Checkout HEAD at verification:** `4958410e44ed2aac765ad9383e91df581862fd6c`
**Working tree:** Not clean; these checks include the current uncommitted changes.

## Local evidence

The repository-pinned JavaScript toolchain was used: Node.js `24.8.0` and pnpm `9.12.0`. A temporary tool directory was used to keep the exact Node executable and pnpm CLI ahead of the machine's unrelated fallback installations; no repository files were changed to establish it.

| Check | Result |
|---|---|
| `pnpm test` | Passed. Workspace tests, Phase 6 (19/19), Phase 4 (7/7), database/runtime cases, AI/voice cases and operations/backup cases completed. The final operations suite reported 26/26 passing. |
| `pnpm typecheck` | Passed across the 20 configured workspace projects. |
| `pnpm build` | Passed across the 20 configured workspace projects, including the optimized Next.js dashboard build. |
| Phase 4 real-PostgreSQL acceptance | 7/7 passed, including checkout, settlement, referrals and OAuth/session persistence. |
| Backup shell regression suite | 8/8 passed when run with the pinned Node test process and the standard Windows Node executable available to Git Bash. |

One initial full-suite attempt reported four backup-shell failures because the npm `node@24.8.0` package places a Bash `node` shim ahead of `node.exe`. The failures did not reach the application assertions. The backup suite passed after isolating the pinned executable from that shim; the full suite was then rerun through the isolated pinned toolchain and completed successfully.

## Remaining acceptance evidence

These local results do not satisfy the Linux/VPS requirements in Phase 2:

- This is a Windows checkout with existing uncommitted changes, not a clean Linux checkout.
- Docker is not installed or available on `PATH`; WSL has no installed Linux distribution.
- No benchmark VPS or target CPU is attached to this session, so Linux builds, image startup and CPU instruction compatibility are unverified.
- Frozen clean install, target PostgreSQL locale provisioning, rendered Compose resource totals, Linux isolation/loopback/DNS and graceful shutdown still need evidence from the target environment.
- Image digests and provisioning results have not been recorded.

Do not mark Task 2 complete until the remaining target-host checks and evidence are attached. The local checks above establish a reproducible Windows baseline only.
