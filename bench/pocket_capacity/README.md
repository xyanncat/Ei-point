# Pocket TTS / Hy-MT2 isolated capacity harness

**Do not run this against the live Ei Point VPS, its `tts`/`hy-mt2` services,
its Docker project, or its nine-CPU `ei-point.slice`.** The harness refuses
known production hosts and requires `EI_BENCH_ISOLATED=1` before it will send
load. A second Compose project on the same VPS is still sharing CPU, memory
bandwidth, storage and networking and is not full isolation.

## Isolation requirements

Use a separate existing VM or host with:

- its own Docker daemon, images, database, volumes, queues, caches and network;
- no production Discord tokens, bot processes, public routes, payment providers,
  moderation effects, backup jobs or production database;
- comparable visible CPU features, Pocket/Hy-MT2 versions, model/voice-state
  revisions and admission limits;
- a hard test CPU/memory budget and a free-space reserve of at least 20% plus
  scratch allowance;
- no production tokens or private user text in scenario files or outputs.

Run smoke first and stop on any functional mismatch. Do not force 100% with
`stress-ng`; saturation must be produced by real model work and observed only
in a short bounded plateau.

## Validate the harness itself

```sh
python runner.py --self-test
```

The local mock server returns a 0.1 s WAV and synthetic translation. The
self-test must report four successes before it is used against staging.

## Configure

Copy `scenario.example.json`, replace the two staging hostnames, and confirm the
isolation block. The rates and mix are **assumption scenarios**, not measured
Discord behavior. Keep the deployed queue/worker/session limits; do not raise
them for the test.

The current Pocket HTTP service returns a complete WAV (no intra-utterance
streaming endpoint). The harness measures the full-file path; the bot's live
`/tts` path is one request for short messages and sentence chunks only above
140 characters. Streaming first-audio and Discord playback are outside this
HTTP harness.

## Run (isolated staging only)

```sh
export EI_BENCH_ISOLATED=1
python runner.py --scenario scenario.example.json --stage smoke --execute --out results/smoke
python runner.py --scenario scenario.example.json --stage warm --execute --out results/warm
python runner.py --scenario scenario.example.json --stage normal --execute --out results/normal
python runner.py --scenario scenario.example.json --stage ramp_1 --execute --out results/ramp_1
python runner.py --scenario scenario.example.json --stage ramp_2 --execute --out results/ramp_2
python runner.py --scenario scenario.example.json --stage ramp_3 --execute --out results/ramp_3
python runner.py --scenario scenario.example.json --stage saturation --execute --out results/saturation
python runner.py --scenario scenario.example.json --stage spike --execute --out results/spike
python runner.py --scenario scenario.example.json --stage soak --execute --out results/soak
```

The 25% ramp steps are explicit stages so each plateau can be reviewed before
continuing. The runner records scheduled, started, successful, 429, timeout and
error outcomes separately; `success_rps` is goodput over the declared window,
not offered RPS. It stops on readiness failure, queue depth above the declared
limit, a rolling error-rate breach or a rolling p95 breach.

## Stop conditions

Stop the generator first, then let in-flight work drain within the client
timeout. Do not kill workers or restart the fleet. Abort on:

- readiness degradation, unexpected model error, restart/OOM, new swap or
  pressure, free space below reserve;
- queue growth or age above the declared limit, or sustained SLO breach;
- host headroom below the predeclared reserve.

A model-only HTTP run excludes Discord gateway/upload/encoding overhead. The
MP4/`/speak` pipeline and actual Discord playback require a separate small
test-guild check, not a mass Discord run.

## Interpretation

- Report **maximum tested sustainable goodput** under the declared SLOs
  separately from the first saturated/failed point.
- Never turn goodput into “maximum Discord members.” Active users are an
  assumption-based division:
  `active ≈ safe_success_rps / requests_per_active_user_per_second`.
  For mixed traffic, identify the shared bottleneck; do not add capacities.
- Do not linearly extrapolate a sandbox budget to the full host.
