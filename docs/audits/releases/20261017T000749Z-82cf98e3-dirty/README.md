# Evidence bundle 20261017T000749Z-82cf98e3-dirty

- Captured: 2026-10-17T00:28:54.582Z (duration 1265.5s)
- Revision: `82cf98e3680f956bc6a7aee1cb45f91c9eb4577a` on `feat/completion-plan` (dirty tree)
- Toolchain: Node v24.21.0, pnpm 9.12.0, Python Python 3.14.7; pinned Node 24.8.0
- Command: `node scripts/verify-project.mjs --json`
- Verifier exit: 0; verifier log sha256 `f51ca95f99d42ac1935da469b063710f3046d799c132f5deb06ffb502ba94ac0`

| Gate | Status | Mandatory | Detail |
|---|---|---|---|
| node-runtime | PASSED | yes | running 24.21.0; pinned 24.8.0 (same major; CI uses setup-node .nvmrc) |
| pnpm-toolchain | PASSED | yes | 9.12.0 |
| python-music | PASSED | yes | .Executing <Task finished name='Task-32' coro=<CacheTest.test_expired_audio_is_downloaded_again() done, defined at C:\Users\DELL\.local\share\opencode\worktree\e0f286\ei-point-completion-2\apps\bots\music-py\tests\test_media_cache.py:59> result=None created at C:\Python314\Lib\asyncio\runners.py:110> took 0.164 seconds \| .Executing <Task finished name='Task-37' coro=<CacheTest.test_hit_and_bounded_lru_preserve_active_audio() done, defined at C:\Users\DELL\.local\share\opencode\worktree\e0f286\ei-point-completion-2\apps\bots\music-py\tests\test_media_cache.py:27> result=None created at C:\Python314\Lib\asyncio\runners.py:110> took 0.148 seconds \| .................Executing <Task finished name='Task-47' coro=<AsyncRuntimeBoundaryTest.test_metadata_timeout_kills_worker_before_releasing_slot() done, defined at C:\Users\DELL\.local\share\opencode\worktree\e0f286\ei-point-completion-2\apps\bots\music-py\tests\test_runtime_boundary.py:67> result=None created at C:\Python314\Lib\asyncio\runners.py:110> took 0.272 seconds \| .Executing <Task finished name='Task-52' coro=<AsyncRuntimeBoundaryTest.test_pause_freezes_offset_and_resume_restarts_clock() done, defined at C:\Users\DELL\.local\share\opencode\worktree\e0f286\ei-point-completion-2\apps\bots\music-py\tests\test_runtime_boundary.py:54> result=None created at C:\Python314\Lib\asyncio\runners.py:110> took 0.119 seconds \| ... \| ---------------------------------------------------------------------- \| Ran 28 tests in 6.947s \| OK |
| feature-coverage | PASSED | yes | Feature coverage structure is valid (structural mode): 179 rows; all rows map to existing targets and tests. |
| feature-coverage-release | PASSED | recorded | Feature coverage structure is valid (release mode): 179 rows; all rows map to existing targets and tests. |
| openapi-sync | PASSED | yes | Dashboard API contract matches apps/api/src/openapi.json (content compared, line endings ignored). |
| root-suites | PASSED | yes | ℹ suites 0 \| ℹ pass 100 \| ℹ fail 0 \| ℹ cancelled 0 \| ℹ skipped 0 \| ℹ todo 0 \| ℹ duration_ms 157776.7602 \| Resource budget ok: runtime 7.45 CPU / 32.5 GiB; concurrent 7.95 CPU / 33.75 GiB. |
| typecheck | PASSED | yes | packages/modules/games typecheck: Done \| apps/dashboard typecheck: Done \| apps/bots/community typecheck$ tsc --noEmit \| apps/bots/himiko typecheck$ tsc --noEmit \| apps/bots/kafka typecheck$ tsc --noEmit \| apps/bots/community typecheck: Done \| apps/bots/kafka typecheck: Done \| apps/bots/himiko typecheck: Done |
| browser | PASSED | yes |   ok 10 tests\browser\public-pages.spec.ts:14:7 › renders /verify on desktop and mobile without overflow (7.4s) \|   ok 11 tests\browser\public-pages.spec.ts:14:7 › renders /missing-kafka-page on desktop and mobile without overflow (4.9s) \|   ok 12 tests\browser\public-pages.spec.ts:35:5 › ambient and artwork motion pause and respect reduced motion (6.3s) \|   ok 13 tests\browser\public-pages.spec.ts:64:5 › homepage and dashboard heroes load, pause and respect reduced motion (12.2s) \|   ok 14 tests\browser\public-pages.spec.ts:101:5 › service filters narrow the catalog and the empty state explains the search (8.4s) \|   ok 15 tests\browser\public-pages.spec.ts:134:5 › verification page covers empty, short, unknown and matching states (12.3s) \|   ok 16 tests\browser\public-pages.spec.ts:166:5 › services page navigates to verification (4.3s) \|   16 passed (2.7m) |
| npm-audit | PASSED | recorded |     "dependencies": 198, \|     "devDependencies": 0, \|     "optionalDependencies": 0, \|     "totalDependencies": 198 \|   } \| } \| (node:11816) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities. \| (Use `node --trace-deprecation ...` to show where the warning was created) |
| python-audit | FAILED | recorded | exit 1: C:\Python314\python.exe: No module named pip_audit |
| container-scan | BLOCKED | recorded | no runner on this host; the service images build in the Linux CI workflow (images job), but no container/OS scanner is configured yet |

Service images build in the Linux CI workflow (images job). Container/OS scanning is not configured on any runner yet and remains BLOCKED — never passed — until a scanner is added (§2B/§10A).

A BLOCKED or FAILED mandatory gate blocks release. Machine-readable copy: `evidence.json`.
