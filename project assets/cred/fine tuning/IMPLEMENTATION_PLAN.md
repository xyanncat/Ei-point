# Cyrene Six-Layer Adaptation Implementation Plan

> **For agentic workers:** Use @executing-plans (or its namespaced equivalent) to implement this plan task-by-task in OpenCode. Track the checkboxes; do not start a different agent workflow automatically.

**Goal:** Produce and evaluate a private six-layer single-speaker Cyrene checkpoint without disrupting the live bots.

**Architecture:** Keep the existing inference service, tokenizer and codec. Adapt a copy of its weights through a pinned compatible Pocket training checkout in a separate environment, then integrate only a qualified export through a local config and integrity manifest.

**Tech Stack:** Existing Python/PyTorch/Pocket service; official Pocket training modules if compatible; Linux cgroup v2 or equivalent hard isolation; existing Discord bot and Compose stack.

**Spec:** README.md, OPENCODE_PROMPT.md, DATASET.md and EXPERIMENT.json in this directory.

## Global constraints

- Six layers only; no deleted teacher, Qwen, paid compute or substitute engine.
- No private assets or transcripts committed; no changes inside the live Python environment.
- Preserve all existing runtime bounds and product contracts until a measured, accepted change justifies otherwise.
- Every safe change committed/pushed; synchronize both required branches and VPS source; record live verification limitations.
- Resource numbers in EXPERIMENT.json are conservative project budgets, not minimum hardware requirements or promised completion times. Total wall budget includes preprocessing, evaluation and all child processes.

## Review focus

- One reference clip cannot provide independent train/test evidence: dataset gate must reject that setup.
- A trainer can appear successful while reinitializing incompatible weights: check keys, tensor shapes, gradients and actual changes.
- A renamed or conditioned stock model is not a fine-tuned checkpoint: require training provenance and held-out improvement.
- A candidate can serve stale baseline audio: cache identity must change with model bytes.
- A failed training or deployment process must not kill live sessions or leave orphan workers: isolate and test teardown/rollback.

## Task 1: Live inventory and feasible route

**Files:** read `docs/operations/pocket-tts.md`, `docs/audits/2026-10-20-cyrene-pocket-tts-migration.md`, `apps/services/pocket-tts/src/main.py`, `prepare_voice.py`, `scripts/prepare_pocket_model.py`, `infra/docker/compose.yml`; create sanitized `docs/audits/YYYY-MM-DD-cyrene-finetuning.md`.

- [ ] Record live source/image/artifact identities and health, CPU flags, actual available RAM/disk, GPU availability and existing isolation hierarchy. Do not dump secrets from environment/Compose.
- [ ] Pin a training source commit. Inspect `training/args.py`, `distributed.py`, `modules/builders.py`, objectives, checkpointing and data loader. Confirm version compatibility with production separately.
- [ ] Trace how six-layer pretrained weights load, how guidance was baked into this student and how the proposed objective affects it. Direct student adaptation is experimental; do not silently apply teacher CFG/sampling defaults to it.
- [ ] Record the smallest supported CPU path, mismatches and measured pilot gate; if blocked, retain the report and preparation deliverables.
- [ ] Verify only safe files staged; publish this completed investigation increment.

## Task 2: Dataset and protected workspace

**Create if data exists:** `scripts/cyrene-finetune/prepare_dataset.py`, focused `test_prepare_dataset.py`, and private run manifests outside Git. Implement `validate_and_split(records, seed) -> split_summary` with source-group partitioning and manifest conversion for the pinned upstream schema.

- [ ] Audit sources per DATASET.md and report unique minutes/utterances, permissions, noise and coverage.
- [ ] Test missing files, bad transcripts, overlapping source clips, duplicate audio and source leakage are rejected before conversion.
- [ ] Prepare aligned manifests and manually audit boundaries; hash outputs. Preserve original audio.
- [ ] If data is insufficient, provide an actionable recording request with missing minutes/coverage; no fake augmentation or full training.
- [ ] Create a private workspace, separate packages and bounded filesystem; verify ignore rules and permissions before outputs exist. Publish safe preparation changes.

## Task 3: Isolated pilot and training

**Create as needed:** `scripts/cyrene-finetune/run_experiment.sh`, `configs/cyrene-finetune/` with resolved schema-valid configs; focused lifecycle/checkpoint tests. Reuse upstream training code in a pinned private checkout; avoid vendoring a trainer.

- [ ] Apply hard CPU, memory, no-swap, PID, disk and wall budgets before loading. Use a dedicated cgroup outside production's constrained parent; if impossible, document actual shared limits. CPU shares/nice alone are insufficient. Verify watchdog can stop the entire job group without selecting unrelated processes. A disk watchdog must account for checkpoint bursts; use a quota/bounded volume where available and refuse writes beyond budget.
- [ ] Test cancellation/child cleanup with a harmless subprocess, plus a failure before output creation. Never test OOM against production. Include checkpointers, data loaders, aligners and evaluators in containment.
- [ ] Test strict baseline loading and output equivalence before training. Freeze intended modules and log total/trainable parameter counts. Do not modify shared HF cache snapshots in place.
- [ ] Run at most the pilot budget; prove finite forward/backward, nonzero intended gradients and weight deltas, immutable codec/tokenizer, saved optimizer/EMA, clean resume and inference export reload. Verify checkpoint trust before loading pickle-based training artifacts; prefer safetensors for deployed weights.
- [ ] Measure seconds per optimizer step, CPU/RSS/disk and production impact, then estimate the proposed stage with honest uncertainty. Abort if limits cannot be enforced or feasibility is poor.
- [ ] With adequate independent data and a passing pilot, run at most the stage/total budget. Monitor validation and audio checkpoints, stop for overfitting or stalled progress. Save the best validation candidate independently of last step. Log actual hyperparameters and optimizer updates; no target of matching an arbitrary step count.
- [ ] Publish safe code/configs/tests/report; checkpoints remain private.

## Task 4: Audio and performance acceptance

**Inputs:** EVALUATION.jsonl plus private held-out reference recordings; **outputs:** private paired audio/metrics and sanitized report.

- [ ] Assert held-out source groups and normalized training text do not leak into evaluation. Add new texts if a line in this supplied corpus already exists in training.
- [ ] Produce baseline/candidate A/B samples with identical inference settings and seeds where supported. Report raw tempo 1.0 and matched production tempo 0.90 as separate comparisons.
- [ ] Measure WER/CER where suitable, speaker similarity with a pinned suitable evaluator if available, clipping, silence, missing/repeated words and EOS. Human listening remains required for Cyrene identity and style; do not invent similarity percentages.
- [ ] Benchmark at least 30 warm cache-miss requests per candidate on the same text mix, recording p50/p95, real-time factor, first chunk and completed WAV time separately, RSS and CPU seconds. Run on isolated candidates, sequentially, within total wall budget; label incomplete samples and skip invalid percentile conclusions. HTTP headers or first bytes of a completed WAV do not prove playable streaming.
- [ ] Read `bench/pocket_capacity/README.md` before reusing that harness. Its load stages require a separate non-production host; never bypass its production guards for this same-VPS experiment. A hard-limited local candidate permits only sequential bounded comparisons under the experiment watchdog, not a full-isolation, saturation or member-capacity claim. Reuse existing measurements/helpers only where their contracts fit.
- [ ] Compare with EXPERIMENT.json promotion gates. Collect owner blind listening verdict. If quality fails, keep baseline, summarize failure and next data need; no automatic large sweep.

## Task 5: Single-voice integration and reversible release

**Modify only if qualified:** existing Pocket service/main tests, preparation/asset manifest code, Compose, operations/backup verification docs. No chat-persona rewrite.

- [ ] Support a private six-layer export via explicit local model config with tokenizer/codec compatibility and strict load checks. Regenerate the fixed Cyrene state using the candidate; do not reuse unverified baseline conditioning.
- [ ] Pin candidate weight hash, config hash, tokenizer hash and candidate-specific state hash; include actual checkpoint identity in cache keys/readiness metadata. Existing upstream revision alone is insufficient. Test that changing weights changes cache identity.
- [ ] Remove exposed voice catalogs, accept `cyrene` and legacy `default` as one fixed speaker, reject all other IDs. Add tests for unknown voices, injected paths, missing/corrupt assets, readiness failure and request-state isolation. Preserve compatibility with existing client calls.
- [ ] Brand owner-facing output Cyrene; retain upstream attribution and private model-card lineage. Do not delete encoder/codec parameters or core speech knowledge to enforce a routing decision.
- [ ] Verify offline export/startup, WAV/MP4 format, queue/busy/timeout bounds, `/speak`, `/tts`, `/leave` and no session leakage. Run existing focused service/bot/asset tests applicable to changed files, following repo-pinned tooling.
- [ ] With audible acceptance and no active session, deploy only affected service(s). Verify health and a bounded smoke; rollback image/config/state/manifest together if needed. Do not delete the original rollback assets.
- [ ] Publish safe changes and reconcile required branches without force push. Pull VPS checkout without restarting services for source-only changes. Record deployed image IDs/health and source-only differences honestly.
