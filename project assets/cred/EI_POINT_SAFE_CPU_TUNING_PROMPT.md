# Ei Point: verify CPU allocation and tune model CPU use safely

Queue this after the model benchmark and do not overlap with command-registration or media-delivery deployments.

---

@verification-before-completion @systematic-debugging @deep-research @ponytail @discord-bots

Review my existing VPS CPU allocation and tune the local TTS/translation services only where evidence supports a measurable improvement. Ei Point is LIVE. Preserve application availability, existing voice/music sessions, model quality, permissions, data and the approved resource envelope. No hardware upgrade, model replacement or provider/hypervisor change is authorized by this task.

## Correct starting interpretation

Do not assume the models have threads but no cores. Threads are scheduled on CPU cores/vCPUs. The supplied benchmark showed about 97-100% idle CPU BEFORE work, falling to about 21% idle / 78% user CPU DURING TTS. On ten vCPUs, sustained 78% aggregate CPU corresponds to about 7.8 CPU-equivalents of user CPU time, not proof of eight dedicated physical cores. It is evidence of substantial CPU use, not zero core allocation.

Previous measured settings: TTS eight threads, translation four, no observed throttling, a nine-CPU parent budget, empty queues and ample memory. Verify these settings now. High CPU occupancy alone is not a performance objective: lower latency with responsive bots is the objective. More threads, higher cpu_shares or CPU pinning do not automatically improve speed. Missing SSE4/AVX/FMA features remain a separate runtime/hypervisor limitation.

## Skills

Resolve and read the actual available skill instructions. An @mention does not install a skill or prove it ran. Report unavailable skills honestly and continue appropriate independent work.

| Phase | Relevant skills |
|---|---|
| Reproduce/interpret the actual bottleneck | @systematic-debugging @verification-before-completion |
| Guest CPU, cgroups and container allocation | @docker-best-practices @monitoring @deep-research |
| Model threading, runtime and latency comparison | @local-llms @performance-profiling @ponytail |
| Preserve Discord behavior and active sessions | @discord-bots @runbooks |
| Minimal fixes and review | @ponytail @code-review @error-handling |
| Controlled rollout and rollback | @release-management @verification-before-completion |

Use the five default skills on the first line throughout. Do not launch subagents unless separately authorized. Use current official Docker, Linux/cgroup, PyTorch and llama.cpp documentation when version-dependent behavior is uncertain. Sources include https://docs.docker.com/engine/containers/resource_constraints/ and https://www.qemu.org/docs/master/system/qemu-cpu-models.html .

## Phase 1: passive inspection and explicit decision

1. Read the actual prior benchmark report and current source/configuration. Verify deployed revision/images, service names, project root, effective thread variables, actual startup arguments and current health. Historical values are not current facts.
2. Record guest vCPU count, exposed instruction features, effective process affinity/cpuset, container and ancestor cpu.max/cpu.weight/cpu.stat, CpuQuota/CpuPeriod/NanoCpus, and model process thread behavior. Use interval deltas for throttling/usage counters. Distinguish aggregate host percentages from docker stats percentages that may exceed 100%.
3. Verify the Docker processes actually belong to the intended nine-CPU parent cgroup. A systemd slice file alone does not establish attachment. Check cpuset.cpus.effective and ancestor limits; an empty configured cpuset may inherit all allowed CPUs rather than mean zero CPUs.
4. Separate independent controls: thread count controls parallel work; affinity limits eligible CPUs; quota caps total CPU time; cpu_shares/weight changes relative priority under contention. Shares do not reserve or create cores. Do not change shares merely because the number looks small or large.
5. Check current queue/inference/session activity, CPU idle/steal/pressure, available memory, swap-in/out and core-service latency. Preserve private user content and secrets; no environment/configuration dumps.
6. Classify the result: verified allocation bottleneck / possible threading inefficiency / runtime or hidden-instruction bottleneck / insufficient evidence. Name the exact supporting observations. If there is no allocation bottleneck, explicitly say so and do not make a cosmetic CPU configuration change.

## Phase 2: prepare the smallest justified experiment

Produce a concrete small change plan and rollback before mutation. Keep the total approved nine-CPU project budget unless an existing later authorized decision supersedes it. Do not reserve all ten vCPUs for the models, remove the project budget, or assign each model a guaranteed nine CPUs. Preserve service memory/security limits and headroom for the bots, database and host.

Only address a proven constraint:

- If a mistaken cpuset restricts a model to fewer eligible CPUs than intended, propose the minimal persistent correction within the approved pool; verify it does not steal a deliberate reservation.
- If a stale per-container quota or an unintended ancestor restriction is causing measured throttling, reconcile it with the intended shared-pool policy. Do not remove valid controls because they exist.
- If measured contention harms interactive tasks, consider scheduler weights only with evidence. Do not use real-time scheduling, privileged containers, taskset pinning by default, CPU governor changes or security bypasses.
- For threading, compare existing settings with a small justified set such as TTS 4/6/8 and Hy-MT2 2/4/6. These are candidate experiments, not instructions to apply all settings on production. Distinguish llama prompt-processing threads from decode threads; prompt prefill was the larger recorded translation cost. Avoid oversubscribing both models relative to the shared budget.
- Keep model precision, quantization, context, output policy and quality constant while comparing CPU settings. Do not lower output limits, truncate input, change voice quality or count cache hits as a performance gain.
- If the VM lacks AVX/SSE4/FMA, do not force instruction flags or enable a previously failing backend. Document provider CPU-feature exposure as an external next step; do not claim thread tuning restores hidden instructions.

Prefer an already available isolated staging environment for configuration sweeps. Do not launch another model copy or sustained sweep on the live VPS. If safe comparable experiments are unavailable, finish the plan and evidence report without applying an unmeasured change.

## Phase 3: controlled test and conditional rollout

This task permits a minimal justified tuning change only when tests and a safe idle window support it. It does not permit interrupting active production use.

- Reuse the earlier benchmark's production-safety gates. Observe baseline health/headroom repeatedly; no deployment/backup/incident, no active model work/queues or dependent voice session, substantial CPU/memory headroom and no swap pressure. If those conditions are unknown or fail, defer changes and live probes.
- Do not restart either model while it is serving a request or needed by a live session. Restart only the affected service if the justified persistent setting requires it; never restart the full fleet, PostgreSQL or unrelated services. A model restart has a warm-up/availability cost: avoid it during live demand and report a pending rollout if no safe window exists.
- Use existing pinned build/release mechanisms, checkpoint the exact relevant configuration without printing secrets, and preserve rollback. Ensure CPU-pooling changes remain compatible with the release resource validator; do not bypass a failing gate.
- Keep tests sequential, tiny and bounded. No artificial parallel workload or saturation test on production. At most one short TTS request and one short translation request for baseline and once again for a candidate, with no automatic retries; use existing valid baseline evidence when comparable and available. Perform no more than one candidate rollout on production during this task. More extensive thread sweeps belong in staging.
- Compare model-loaded and equivalent cache conditions, text/output length, queue delay, model timing, end-to-end timing, TTS audio duration/RTF, translation prompt/decode timings, service latency and CPU pressure. Verify actual WAV sample rate/channels/sample width before computing duration and RTF. Do not manufacture p95 from two requests.
- Never force cache eviction, repeated cold starts, extra GPU/model installs, or long stress probes. A client timeout may leave inference running; stop further admissions and verify the worker settles, without killing production workers as a benchmark shortcut.
- Stop changes on errors, growing queues, new restarts, health degradation, inadequate host headroom or worse latency. If a candidate regresses and safe rollback is possible, restore the exact prior setting and affected service in an idle window. Do not leave a speculative configuration installed or restart a newly active service blindly.
- Retain a setting only if comparable measurements support a useful improvement without harming shared-service behavior. If results are noisy or equal, keep the existing configuration. No change is a valid outcome when there is no proven benefit.

## Final deliverables

Write docs/audits/<actual-date>-model-cpu-allocation-and-tuning.md with:

- What cores/vCPUs the services could actually use before and after, ancestor limits and thread settings.
- The actual explanation of the apparent 0% usage and correct normalization of CPU measurements.
- Proven bottleneck versus remaining hypothesis, including hidden CPU features.
- Exact tested settings, safe environment/window, cache conditions, request budgets, timings and confidence limits.
- Any persistent source/configuration changes, tests, deployed revision and rollback checkpoint; or an explicit no-change/pending status.
- Effects observed on bot/database/model health and existing session continuity.
- A prioritized recommendation without unsupported speedup promises.

Do not claim "more cores fixed it" unless the original allocation was actually restrictive and fresh comparable evidence supports that explanation. Do not promise zero production impact or guaranteed latency. Do not mix this task with duplicate-command cleanup, MP4/media delivery or model replacement. Leave the project running safely.
