# Evidence bundle 20261016T211613Z-38b1fe28-dirty

- Captured: 2026-10-16T21:20:26.372Z (duration 252.8s)
- Revision: `38b1fe285c73798bfba9fcc51197b56c75cdf97f` on `feat/completion-plan` (dirty tree)
- Toolchain: Node v24.21.0, pnpm 9.12.0, Python Python 3.14.7; pinned Node 24.8.0
- Command: `node scripts/verify-project.mjs --json`
- Verifier exit: 0; verifier log sha256 `0ecae6c096c520a756cc1c04250d3fbbfcea5dc0483ef38845e010a4d0cb6a0a`

| Gate | Status | Mandatory | Detail |
|---|---|---|---|
| node-runtime | PASSED | yes | running 24.21.0; pinned 24.8.0 (same major; CI uses setup-node .nvmrc) |
| pnpm-toolchain | PASSED | yes | 9.12.0 |
| python-music | PASSED | yes | ............................ \| ---------------------------------------------------------------------- \| Ran 28 tests in 0.687s \| OK |
| feature-coverage | PASSED | yes | Feature coverage structure is valid (structural mode): 179 rows; all rows map to existing targets and tests. |
| openapi-sync | PASSED | yes | Dashboard API contract matches apps/api/src/openapi.json (content compared, line endings ignored). |
| root-suites | PASSED | yes | ℹ suites 0 \| ℹ pass 94 \| ℹ fail 0 \| ℹ cancelled 0 \| ℹ skipped 0 \| ℹ todo 0 \| ℹ duration_ms 39244.8713 \| Resource budget ok: runtime 7.45 CPU / 32.5 GiB; concurrent 7.95 CPU / 33.75 GiB. |
| typecheck | PASSED | yes | packages/modules/games typecheck: Done \| apps/dashboard typecheck: Done \| apps/bots/community typecheck$ tsc --noEmit \| apps/bots/kafka typecheck$ tsc --noEmit \| apps/bots/himiko typecheck$ tsc --noEmit \| apps/bots/community typecheck: Done \| apps/bots/kafka typecheck: Done \| apps/bots/himiko typecheck: Done |
| browser | PASSED | yes |   ok 10 tests\browser\public-pages.spec.ts:14:7 › renders /verify on desktop and mobile without overflow (2.2s) \|   ok 11 tests\browser\public-pages.spec.ts:14:7 › renders /missing-kafka-page on desktop and mobile without overflow (2.5s) \|   ok 12 tests\browser\public-pages.spec.ts:35:5 › ambient and artwork motion pause and respect reduced motion (2.2s) \|   ok 13 tests\browser\public-pages.spec.ts:64:5 › homepage and dashboard heroes load, pause and respect reduced motion (3.7s) \|   ok 14 tests\browser\public-pages.spec.ts:101:5 › service filters narrow the catalog and the empty state explains the search (2.4s) \|   ok 15 tests\browser\public-pages.spec.ts:134:5 › verification page covers empty, short, unknown and matching states (3.1s) \|   ok 16 tests\browser\public-pages.spec.ts:166:5 › services page navigates to verification (1.5s) \|   16 passed (52.4s) |
| npm-audit | FAILED | recorded | exit 1:     "dependencies": 199, \|     "devDependencies": 0, \|     "optionalDependencies": 0, \|     "totalDependencies": 199 \|   } \| } \| (node:9124) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities. \| (Use `node --trace-deprecation ...` to show where the warning was created) |
| python-audit | FAILED | recorded | exit 1: C:\Python314\python.exe: No module named pip_audit |
| container-scan | BLOCKED | recorded | no local runner; executed by the Linux CI workflow |

Linux image build and container/OS scans require Docker on a Linux host; recorded as BLOCKED, never passed (§2B/§10A).

A BLOCKED or FAILED mandatory gate blocks release. Machine-readable copy: `evidence.json`.
