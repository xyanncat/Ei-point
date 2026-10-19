# Pocket capacity benchmark prompt delivery -- 2026-10-20

Scope: documentation handoff only; no inference, hardware microbenchmark, stress test, application change, service restart or deployment was performed.

## Deliverable

`project assets/cred/EI_POINT_POCKET_TTS_CAPACITY_BENCHMARK_PROMPT.md` covers post-migration Pocket TTS/Hy-MT2 timing, CPU/cgroup allocation, memory/RSS/growth/bandwidth evidence, storage/I/O, application/media pipeline overhead, streaming, workload modeling, bounded load/stress/spike/soak, overload recovery and qualified active-user estimates.

## Production safety and interpretation

The prompt distinguishes passive live checks, at most four tiny sequential live inference requests, and isolated staging stress. Full-host saturation must not run beside the live project. A second Compose project on the same VPS does not isolate memory bandwidth/storage/CPU contention. An unavailable isolated environment leaves saturation and maximum capacity blocked, with harness/dry-run artifacts still required.

CPU saturation is expressed relative to the approved test budget; successful throughput is separated from offered/rejected traffic. Hardware metadata is distinguished from measured bandwidth; cache-backed I/O is not claimed as physical disk speed. Member counts require an explicit active-request frequency/mix and are not inferred from parameter count or RPS alone.

## Verification and publication

The document is checked for default skill mentions, the three environment modes, live request budget, isolation/hard-stop rules, RAM/storage coverage, saturation/recovery phases, workload/percentile caveats, user-capacity assumptions, and repository publication requirements. Only the prompt and this audit are included in the delivery commit after staged-file and credential-pattern checks. Application tests and performance results are not claimed for this prompt-only change.

Starting source: `67815a2`; the delivery revision is the commit containing this report. Both remote branches are to be pushed together and verified. Actual VPS source revision, running image IDs and health were not inspected here because no authorized direct SSH route is available and the prior browser terminal was blocked. The VPS source-only pull remains pending access. No service rebuild/redeploy is necessary to retrieve these documents.
