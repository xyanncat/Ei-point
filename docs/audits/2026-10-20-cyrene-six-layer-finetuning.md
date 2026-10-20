# Cyrene six-layer fine-tuning report — 2026-10-20

Status: **prepared / insufficient data**. The direct six-layer CPU route was
assessed and is **not run**: the dataset gate fails, the upstream trainer
requires a GPU, and no isolated training environment or VPS console is
available. No fine-tuned checkpoint, candidate audio, voice state or deployment
exists. Production remains on the existing six-layer Pocket model.

## Source and live baseline

- **Local repository:** base `a717f21`; the fine-tuning handoff, dataset
  validator/tests and this report are the publication commit. No dirty
  source work was discarded.
- **VPS checkout:** last known `995fc1f`; the newer commits are **not pulled**
  because the provider serial console stopped returning a shell (`starting
  serial terminal on interface serial0`; fresh xTerm/noVNC failed; no local
  SSH route). No service was restarted.
- **Running TTS/bot:** last verified Pocket service image
  `sha256:ca7197c8…`, bot-ai `sha256:f9169b66…`; six-layer English model,
  voice-state hash `c053f46f…`, tempo 0.90; 13/13 containers healthy before
  the console loss. This is prior same-deployment evidence, not a fresh
  live check.
- **Rollback:** the current six-layer Pocket image, weights, tokenizer, codec
  and voice state are untouched. Qwen is **not restored** (the fine-tuning
  handoff forbids it; it was explicitly removed in the preceding task). The
  rejected 24-layer model is **not restored or used**.
- **GPU:** none visible on the VPS. Production 9-CPU slice unchanged.
- **Resolved skills:** `fine-tuning`, `local-llms`, `python-performance`,
  `performance-profiling`, `load-testing`, `docker-best-practices`,
  `writing-plans`, `executing-plans`, `data-validation`,
  `verification-before-completion`, `systematic-debugging`, `deep-research`,
  `ponytail`, `discord-bots`. No essential workflow was missing. The installed
  `fine-tuning` skill is chat/LoRA-oriented and was not applied as a speech
  recipe.

## Dataset

- One owner-supplied reference MP3 is known: 249,171 bytes, **15.569 s**,
  44.1 kHz mono, SHA-256
  `73A3B7AEDBC95BCDD0ADF4A6304DD3C47EC7A69D06BA6182F77945B32C031561`.
  It is already tracked from earlier provisioning; no copy was added.
- **Usable training clips: 0.** The reference transcript was not independently
  reviewed in this task; permission basis is not recorded; one recording
  cannot provide independent train/validation/test groups.
- Unique usable minutes: **0.259** (reference only), versus the project target
  of **20–60 minutes**. Missing at least **19.741 minutes**, preferably more.
- Independent source groups: **1**, versus the 5 required for a source-group
  80/10/10 split. No aligned manifest was written.
- `EVALUATION.jsonl` provides 20 synthetic public texts, but no held-out audio;
  it was not used for training and cannot prove identity.
- **Verdict: `insufficient_data`.** A production fine-tune was not started.
- **Concrete request:** 20–60 minutes of clean, varied, single-speaker English
  Cyrene speech authorized for adaptation; at least five independent
  source/session groups (or a separate independent validation/test set);
  human-reviewed transcripts; recorded permission/provenance; coverage of
  neutral, gentle, playful, reflective, question, name, number and punctuation
  delivery. Reject music-heavy, multi-speaker, clipped or overlapping audio.
  Do not duplicate the 15.6 s reference or train on generated Pocket/Qwen
  audio.

## Training feasibility and run

- Pinned source: **v3.3.0, commit
  `3dbee45d343d7dddd0d105468d17f8dcba14db3e`**; installed package 3.3.0.
  The upstream training code was inspected in a temporary checkout and is not
  vendored into this repository.
- Official `finetune.yaml` targets the **24-layer English teacher**
  (`english_2026-04_24l.yaml`). The only six-layer recipe is
  `depth_distill.yaml`, which requires a 24-layer teacher and 200,000 steps;
  the teacher route is forbidden by this task.
- Direct six-layer adaptation from the released `english.yaml` weights is
  **experimental**: the trainer’s `start_from_pretrained`/safetensors loader
  could build the six-layer architecture, but there is no official recipe,
  baseline or quality evidence for this route.
- CPU route: `training/distributed.py` requires CUDA unless
  `POCKET_TTS_ALLOW_CPU=1`; its own comment calls CPU training accidental, not
  a use case. The official README requires one NVIDIA GPU. The VPS has no GPU.
- The experiment limits are 2 CPU cores, 6 GiB, no swap, 64 tasks, 10 pilot
  steps/600 s and 7,200 s/1,000 steps total. No isolated training host exists;
  the live 9-CPU production slice must not be altered. A CPU pilot was **not**
  run; no step-time, RSS or throughput number is claimed.
- **Gate order:** dataset insufficiency blocks the pilot before any model
  load. The missing data request above is the primary blocker; the unsupported
  CPU/GPU route is the secondary technical blocker. No training config was
  presented as validated.
- No loss, gradients, optimizer, checkpoint, resume or export checks were
  run; no checkpoint was produced.

## Candidate comparison

| Metric | Baseline | Candidate | Conditions / evidence |
|---|---|---|---|
| Owner blind voice preference | current six-layer Pocket | none | no candidate |
| Held-out WER/CER | not measured | not measured | no held-out audio |
| Speaker similarity | not measured | not measured | no candidate |
| Missing/repeated words, clipping, noise | not measured | not measured | no candidate |
| Warm-miss p50/p95 | prior capacity baseline only | — | not a fine-tuning result |
| First playable / completed WAV | prior baseline only | — | not a fine-tuning result |
| RTF / CPU seconds | prior baseline only | — | not a fine-tuning result |
| Idle / peak RSS | prior baseline only | — | not a fine-tuning result |

No paired audio or listening labels exist. The owner’s previous feedback
(pace accepted, clone similarity/clarity still not accepted) remains the
product baseline; it is not evidence that a candidate was trained.

## Integration and deployment

- No model, voice, config, Compose, bot or translation change was made.
- The single-voice integration work was not started because no candidate
  exists.
- `/tts`, `/leave`, `/speak`, Hy-MT2, permissions, command registration and
  the current Components V2 media path remain on the untouched baseline.
- No cutover or owner listening occurred. Rollback is the existing six-layer
  Pocket image/state; Qwen is not a rollback and was not restored.

## Validation work completed

- `scripts/cyrene-finetune/prepare_dataset.py`: validates source/permission
  fields, file existence, SHA-256, WAV duration, duplicate audio, overlapping
  intervals and source-group leakage; enforces the 20-minute/5-source gate;
  refuses to write a trainer manifest when the gate is blocked; converts only
  validated clips to the pinned `path/duration/transcript` JSONL.
- `scripts/cyrene-finetune/test_prepare_dataset.py`: **8/8 tests pass**
  locally. The test uses temporary synthetic WAVs only; no private audio or
  text is committed.
- CI workflow: added a fine-tuning dataset test step.

## Git and VPS sync

- Safe source/docs/tests are published in this commit on `main` and
  `feat/completion-plan`.
- **VPS source pull is pending** because the provider console is unavailable.
  The VPS remains at its last known `995fc1f`; no service was restarted and no
  source-only pull was falsely claimed.
- The migration prompt’s “keep a Qwen fallback” text is superseded by the
  later owner removal and this handoff’s explicit “do not restore Qwen.” The
  working six-layer Pocket model is the rollback.

## Remaining blockers

1. **Data:** at least 19.741 more unique minutes, five independent source
   groups/sessions, reviewed transcripts, permission basis and coverage.
2. **Compute:** no GPU; upstream CPU training is unsupported/accidental; no
   isolated CPU training host or verifiable experiment budget.
3. **Access:** VPS provider console unavailable for live inventory, source
   pull and any future bounded pilot.

No fine-tuned Cyrene checkpoint exists. No claim of improved timbre, identity,
intelligibility or CPU performance is made.
