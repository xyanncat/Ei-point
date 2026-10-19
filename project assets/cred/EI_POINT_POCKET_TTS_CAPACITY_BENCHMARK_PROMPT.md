# Post-Pocket TTS benchmark: production safety, hardware evidence, stress and capacity

Queue AFTER Pocket TTS migration and its functional acceptance. Do not overlap with source/configuration deployments, earlier benchmark jobs, command-registration repair, or active voice/music work.

---

@verification-before-completion @systematic-debugging @deep-research @ponytail @discord-bots

Create and execute an evidence-backed post-migration assessment of Ei Point with Pocket TTS on the existing VPS. Cover first-audio/complete-response latency, actual CPU allocation, memory footprint and bandwidth limitations, storage behavior, queues, stability, overload recovery and sustainable user workload. I also want a stress/capacity test, including the observed behavior near 100% of the APPROVED TEST CPU budget, but my live project must remain available.

Deliver actual measurements where safe, reproducible scripts/configuration, a detailed sanitized report, and explicit unmeasured gates. This is benchmark authorization, not authorization to tune/change production, migrate models, restart live services, interrupt sessions, run payments/sanctions, purchase infrastructure, or silently claim that a simulated workload proves Discord capacity.

## 1. Skills and responsibility

Read actual available skill instructions through the registry or supplied files. An @mention does not install/register a skill. Report missing skills and use equivalent workflows honestly. Do not invoke all skills mechanically or delegate unless separately authorized.

| Work package | Skills |
|---|---|
| Preconditions, baseline and bottleneck interpretation | @systematic-debugging @verification-before-completion |
| CPU/Pocket/voice state/Hy-MT2 inspection | @local-llms @performance-profiling @deep-research |
| Traffic model, arrival-rate runner and saturation | @load-testing @llm-evals @ponytail |
| Container/cgroup/environment isolation | @docker-best-practices @monitoring @runbooks |
| Process memory, growth and cleanup | @memory-leaks @performance-profiling |
| Discord contract and end-to-end checks | @discord-bots @verification-before-completion |
| Artifact integrity and report publication | @data-validation @git-commits @verification-before-completion |

Use official Pocket TTS, PyTorch, llama.cpp, Linux/cgroup, Docker and load-runner documentation for version-dependent claims. Vendor CPU/GPU results and prior reports are comparison inputs, never measurements of this run. Do not disclose private project/user data to external research services.

## 2. Three explicit execution modes -- never confuse them

A. LIVE-PASSIVE: read existing metrics/logs/configuration and perform bounded lightweight health observations. This is the starting/default mode.

B. LIVE-TINY: at most FOUR sequential synthetic inference requests total, no more than two per model, only after the live gates below pass. No repeated sweeps or concurrency tests. These are spot checks; they cannot establish p95 or maximum capacity.

C. ISOLATED-STRESS: real load, stress, spike, hardware microbenchmarks, cold starts and soak ONLY on a verified isolated staging deployment with no production Discord tokens, no production DB/volumes, no public routes/jobs, separate queues/caches and a hard test resource budget. Prefer a separate existing VM/host with comparable guest CPU features, runtime and limits. Do not purchase one.

A second Docker Compose project on the SAME live VPS is NOT full resource isolation: CPU, memory bandwidth, storage and networking remain shared. A same-host sandbox with tightly limited verified cgroups can support a limited-budget experiment only when production headroom permits, but it must not saturate the host or the production nine-CPU slice. Label its results as sandbox-budget capacity and do not scale them linearly into full-host claims. If isolation/headroom cannot be proven, run only modes A/B, prepare and dry-run the stress harness, and mark maximum-capacity/100%-load tests BLOCKED by the exact missing environment. Do not disable or stop the live project just to finish a benchmark.

No live or stress test can guarantee zero impact. Stop or defer rather than weaken this boundary. Never describe an unexecuted stress test as passed.

## 3. Discovery and production baseline

Read applicable AGENTS.md, current migration/benchmark reports, service contracts and resource/release documentation. Verify the actual root, branch/commit, image IDs, dirty state, model/reference/voice-state identifiers, service names, health, current thread/worker/queue/session limits, and running engine. Verify that Pocket actually serves BOTH /tts and /speak; do not benchmark Qwen behind an old service alias and label it Pocket.

Record actual timestamp/timezone and clock differences, Python/Node/PyTorch/Pocket/llama versions, model/codec/language revisions, precision/quantization, thread controls, streaming/framing, and preloaded/private voice-state behavior. Do not copy audio/voice states/weights into the report.

Collect at least three short baseline observations over roughly 15-30 seconds, using existing tools:

- Guest CPU model/vCPUs/topology, virtualization and exposed instruction flags; effective affinity/cpuset, per-container AND ancestor cpu.max/cpu.weight/cpu.stat, relevant process/slice membership. Verify the claimed parent budget actually applies. Record interval deltas, not lifetime nonzero counters as present throttling.
- Host and model-container CPU time, idle/user/system/iowait/steal, CPU/memory/I/O pressure, load averages and task/thread counts. Distinguish aggregate host %, Docker CPU % (100% may mean ONE vCPU), and % of the approved cgroup budget.
- Host MemAvailable, swap-in/out, process/container RSS and memory.current/peak, cache versus anonymous memory and cgroup memory events. Use PSS when available without excessive privileged inspection; label shared-page double counting in summed RSS.
- Existing queues, active generations/streams, voice leases, request latency, DB pool/connection pressure, event-loop lag, outbox/job backlog, restarts, OOM events and readiness.
- Safe network observations: loopback/internal request times and existing ingress/Discord timing. No speedtest download/upload or public endpoint flooding.

Preserve existing service/session behavior. Do not dump .env, full docker inspect/config or private logs. Extract only needed fields, redact credentials and private user text, and bound output.

## 4. Memory, storage and CPU evidence

Separate hardware metadata, application behavior and synthetic bandwidth results. Do not infer RAM speed, physical disk model or a physical-core guarantee from the VPS plan, a generic guest name or a large free-memory value.

Memory:

- Record visible RAM size, NUMA/topology and any trusted exposed memory-controller information; label absent/virtualized SMBIOS frequency or topology as unknown/unverified. Do not claim a physical DDR speed from bandwidth alone.
- Measure Pocket's idle-loaded model plus cached Cyrene state, active generation peak, post-request retained memory and repeated-workload trend in staging. Identify baseline runtime overhead separately from per-request buffers, stored audio and conversion processes.
- Measure memory-bandwidth sensitivity using a bounded existing trusted STREAM-like benchmark ONLY in isolated stress mode: fixed documented small allocation (for example <=512 MiB and within the test memory budget), bounded duration and small thread set. Do not allocate most RAM, force swapping, run memory fault tests, install tooling in serving containers, or infer a precise physical RAM specification.

Storage:

- Passive production checks: filesystem/mount type, volume/virtual block-device visibility, free bytes/inodes, observed IOPS/throughput/await/queue, I/O pressure, existing log/cache/temp growth and container layer versus mounted-volume location. Label unknown backend/physical SSD details honestly.
- On isolated disposable test storage only, use a known existing fio/equivalent tool with a uniquely created scratch file, finite size (initially <=256 MiB), bounded runtime (<=30 seconds per case), bounded queue depth, and free-space guards. Measure short sequential read/write and low-depth 4 KiB random I/O where relevant. Never target a raw block device, live DB/WAL, backup store, shared production filesystem, private audio/models or an existing file. Do not fill the disk, change mount settings, issue TRIM, or run direct I/O against arbitrary targets.
- Document buffered/cache versus direct I/O support and FS semantics. A tiny cached read test measures the page cache, not SSD speed; do not clear the host page cache to manufacture a cold run. If the test file is too small to measure storage bandwidth credibly, say so and report only that limited result.
- Measure actual application storage work in staging: model/voice-state startup reads, short generated audio writes if used, MP4 temporary files, cleanup and cache growth. Do not equate storage microbenchmark MB/s with model latency.

No stress tool is to be installed on production as part of discovery. If optional hardware tools are unavailable, document that and continue application measurements.

## 5. Low-impact live probe gates

Before any mode-B request: stable healthy services, no active generation/queue/dependent voice session, no deployment/backup/incident, roughly >=50% CPU idle, no significant swap/throttling/pressure, and MemAvailable greater than BOTH 20% of RAM and 4 GiB. If idle state or headroom cannot be verified, do not probe. Historical stress recovery faults must be resolved or isolated before probing a service likely to hang.

Use fixed short public synthetic text and the actual private service endpoints, not public Discord messages. One Pocket English greeting and one short Hy-MT2 translation are the first pair. At most one additional short request per model is allowed if all gates still pass; label repeat/cache state explicitly. Do not force cache eviction or add a warm-up series. Read existing counters to distinguish response-cache hits from model-loaded operation.

Match the known service deadline with bounded client grace, capped at 120 seconds; if it cannot be safely established, skip. A client timeout may leave generation running: stop further admission, observe worker completion, report the incident, and never kill production workers as a cleanup shortcut. Stop new probes as soon as real traffic or a health/headroom issue arrives.

Record headers, first chunk, first PLAYABLE PCM/Opus where instrumented, and final body separately. A full-WAV response's header arrival is not first playable speech. For /speak, separate model generation, MP4 conversion and upload. Native Discord-client playback/voice quality is a separate small owner/test-guild check, not inferred from a response code or JSON payload.

## 6. Define a realistic staging workload before stress

Freeze a versioned scenario file with actual endpoints, cgroup budget, queue/worker/session limits, seeds, public synthetic inputs, duration, max arrivals/in-flight/response bytes and explicit pass/abort thresholds. Reuse an existing trusted runner (k6/Locust/standard library) appropriate for streaming. Do not add a large framework when existing tooling suffices. Validate the load generator itself before execution.

Model at least these workload classes separately:

- Pocket short/medium/long English speech, e.g. 20/100/300 characters within the actual input cap, fixed approved voice-state revision. Include punctuation/numbers and a small fixed pronunciation set. Match audio durations, not just characters, when interpreting capacity.
- Streaming /tts and complete-file /speak paths separately, including local media conversion in the latter. A model-only HTTP run excludes Discord/upload/encoding overhead; label that boundary.
- Hy-MT2 short/medium permitted text, actual required target/optional source contract, language pairs and bounded output. Keep current measured settings unless separately authorized to tune them.
- Normal bot/API/job background work using staging data and internal harnesses. Isolate payment providers, disable real settlements/moderation effects and outgoing notifications/Discord registration. Do not connect staging bots using production tokens or send mass requests to Discord.
- Mixed load with an explicitly declared TTS/translation/ordinary-command ratio and think times. If real traffic proportions are unknown, use labeled assumption scenarios rather than pretending they are measured user behavior.

Use a seeded public corpus to separate exact response-cache hits from genuine uncached generation in STAGING. Track cache outcomes and prompt-prefix reuse explicitly. Keep language/model/quality settings equal. Do not bypass per-user cooldowns, session ceilings or queue limits when estimating the shipped product's capacity. An optional engine-only test with different admission limits must be separately labeled and must not be used as product capacity.

Use an open arrival-rate model where supported. Count scheduled, started, accepted, successful, rejected (including 429), timed-out, cancelled, unfinished and dropped-generator requests separately. Report goodput, not just offered RPS or a rapid stream of overload responses. Measure scheduled-arrival waiting and avoid coordinated omission. Validate the generator is not the bottleneck; prefer a separate existing generator host. Include generator resource cost if co-located.

## 7. Staged load, stress, spike and soak

Run only with verified mode-C isolation; no live-host 100% test.

1. Smoke: one request at a time, verify correct voice/output/streaming/cleanup and valid metrics. Stop on functional errors before increasing load.
2. Warm functional baseline: a bounded small corpus, distinguishing startup/first inference, model-warm misses and exact response-cache hits. Cold-start/restart measurements occur only in isolated staging; do not drop the production page cache.
3. Normal load: begin well below measured single-worker throughput, then hold the declared expected workload for about 10-15 minutes if the predeclared time/resource budget permits.
4. Ramp: increase offered workload in small relative steps (for example 25%) with 2-5 minute plateaus, not an arbitrary high initial RPS. Bound generator clients/in-flight work and total test duration (initially <=30 minutes for this ramp). Recheck stage thresholds every interval. Preserve the actual deployed admission controls.
5. Saturation: identify the first SLO breach or persistent queue growth. Record bottleneck/resource and successful throughput. If real model work reaches near 100% of its approved TEST CPU allocation, observe a short bounded plateau, initially <=60 seconds. Do not use unrelated stress-ng work to force 100% and call it model capacity; do not keep raising traffic when the worker is saturated and requests merely reject.
6. Overload/recovery: in staging only, apply one bounded burst above the last sustainable rate, then stop arrivals and measure queue drain, ongoing computation/cancellation, readiness, memory/buffer cleanup and time to healthy baseline. No request loss/duplicate domain effects should be silently relabeled as success. A server timeout must not hide an orphan worker.
7. Soak: once a safe operating point is identified, hold it for 30-60 minutes initially, within the declared budget, to inspect memory/disk/FD/thread/cache growth and queue stability. Report exact duration; this does not certify a 72-hour soak. A longer observation belongs to a separately scheduled plan, not an invented result.

Do not tune parameters during the comparison. If a fix is needed, end the benchmark, document it, and treat a changed revision/configuration as a new run.

Define the sustainable point by useful outcomes and latency, not CPU utilization alone. Set SLOs from approved product requirements or declare proposed thresholds BEFORE execution. Record first-audio and completion p50/p95/p99 only when sample counts warrant them; otherwise report small-sample values and limitations. Throughput at 100% CPU is a saturation observation, not the recommended continuous operating point. Reserve measured operating headroom and report the chosen safety margin.

## 8. Hard stop conditions and recovery

In LIVE modes: immediately stop admission on any production readiness degradation, unexpected model error, restart/OOM, active queue/voice work, new swap/pressure, inadequate headroom or a significant observed latency regression. Do not admit more work to obtain a better graph.

In STAGING: predeclare thresholds for maximum RSS/memory budget (e.g. stop at 80% with a firm reserve), free-space reserve (at least 20% plus scratch allowance), bounded queue depth/age, request deadline, open FDs, error budget, and maximum unfinished work. Expected 429 responses are overload evidence but lower useful service capacity. Stop arrivals on sustained SLO violation, growing queues, swap thrashing, OOM/restart, unexpected errors or insufficient host headroom. CPU saturation alone is permitted only for the bounded isolated plateau.

The runner must have a fixed end time and a bounded drain period and identify only its own requests/processes/files. Stop the generator first. Do not kill production services, perform host reboot, change credentials, delete unknown files, reset the database, purge caches, or automatically restart the fleet. Collect evidence before cleanup. Isolated worker-failure recovery tests must not affect production and must be clearly separate from normal-load results.

## 9. Convert throughput into a qualified active-user estimate

Do NOT report 'maximum Discord members per second' directly from model RPS. A registered guild member may be idle; one /tts utterance may serve many listeners; one active writer may generate multiple jobs; voice-session caps, per-user cooldowns, queue limits and Discord rate limits may bind before CPU.

Report:

- Offered RPS, admitted RPS and successful RPS under each declared latency/error target.
- Generated audio seconds per wall second, streaming concurrent outputs, buffer underruns and per-stream real-time factor.
- Model-only versus complete local /speak pipeline versus tested end-to-end boundaries.
- Maximum tested sustainable workload, first saturated/failed point and recommended operating point, with sample size and configuration.
- Active-user estimates only under explicit request-frequency and workload-mix assumptions. For a homogeneous workload: active users approximately safe successful RPS / requests-per-active-user-per-second. For mixed traffic, check every shared service and bottleneck; do not add independent standalone capacities.
- Illustrative arithmetic only: IF safe goodput were 2 requests/second AND each active user sent one request/minute, that implies about 120 simultaneously active requesters under that model, not a measured result, guild membership limit or promise. Do not reuse those example numbers as benchmark facts.

A test with mocks cannot establish live Discord gateway/API limits. Do a few safe real test-guild checks for contract acceptance if available; never mass-create accounts/users or flood Discord to seek a maximum.

## 10. Final artifacts, evidence and Git/VPS synchronization

Create a sanitized report `docs/audits/<actual-date>-pocket-tts-capacity-benchmark.md`, small reproducible harness/scenario files, and compact CSV/JSON summaries. Keep unbounded logs, full recordings, private voice audio/state, credentials and model weights out of Git. Maintain owner-private raw artifacts with bounded retention; include safe checksums/references where needed. Record exact hardware-visible capabilities, resource limits, model/revisions, images, scenarios, timestamps/timezone, counters/intervals, sample counts, command exits, skipped/blocked cases and benchmark-induced cache/metric writes.

The final tables must include: environment/mode; baseline/peak CPU/RSS; memory growth; known/unknown memory bandwidth and storage evidence; first audio/model generation/HTTP/MP4/upload latency; exact decoded audio duration/RTF; translation prompt/decode/total timings; goodput/queue/rejection/error results by workload; saturation and recovery; recommended safe rate and assumption-based active users. Explain uncertainty and avoid extrapolating a limited-budget sandbox into full-server performance.

Conclude with live health/restart/session comparison to baseline and any observed impact, without an absolute 'zero impact' guarantee. State explicitly whether the 100%-load/max-capacity test ACTUALLY ran and in which isolated budget; otherwise identify the blocker and provide the ready-to-run plan. Do not claim 'everything stable' from a spot check or minutes-long soak.

Follow repository rules: scan staged artifacts for secrets, commit and push every change, synchronize main and feat/completion-plan without force-pushing/overwriting unrelated work, and source-sync /opt/ei-point when authorized access is available. Source-only synchronization must not restart production models/bots. Record running deployment revision/image IDs/health separately from the documentation commit, and report any inaccessible VPS sync as pending. No tuning or redeployment of production is authorized in this benchmark task.
