# Cyrene six-layer fine-tuning report — YYYY-MM-DD

Status: prepared / insufficient data / pilot failed / pilot passed / trained / ready for owner listening / accepted / deployed / rolled back. Select only evidenced stages.

## Source and live baseline

- Repository revision, clean/dirty state and required remote branch revisions:
- VPS source revision verified at UTC time:
- Running TTS/bot image IDs and health; active-session handling:
- Base config/package/checkpoint/tokenizer/voice hashes and precision:
- CPU flags, effective cgroup budget, GPU visibility, available RAM/disk:
- Baseline WAV and separate model/HTTP/MP4 latency evidence:
- Resolved skills and missing workflows:

## Dataset

- Authorized source count, unique usable minutes, utterances and coverage:
- Train/validation/test source-group counts and manifest hashes:
- Transcript/alignment review, leakage checks and rejected data:
- Adequacy verdict and concrete missing-data request if needed:

## Training feasibility and run

- Pinned upstream code commit, compatible APIs/config schema and exact command:
- Direct six-layer objective justification, loaded/missing tensor keys:
- Frozen/trainable parameter counts and changed-tensor evidence:
- Isolation identity and verified CPU/RAM/PID/disk/wall limits:
- Resolved optimizer, learning rate, schedule, batch/accumulation, seeds, precision:
- Pilot forward/backward/save/resume/export checks and measured step time:
- Total elapsed/CPU seconds, steps, peak RSS/disk, production effects:
- Training/validation curves, overfit/early-stop reason, candidate artifact hashes:
- No skipped gate represented as passed:

## Candidate comparison

| Metric | Baseline | Candidate | Conditions / evidence |
|---|---|---|---|
| Owner blind voice preference | | | pending until supplied |
| Held-out WER/CER | | | evaluator/version/sample count |
| Speaker similarity | | | model-specific score, not identity probability |
| Missing/repeated words, clipping, noise | | | |
| Warm miss p50 / p95 | | | number of requests, text mix |
| First playable audio / completed WAV | | | separately observed |
| Real-time factor / CPU seconds | | | audio duration and tempo |
| Idle / peak RSS | | | |

Private paired-audio locations; listening labels/key location; no private transcript/audio pasted here:

## Integration and deployment

- Single-voice API/legacy alias, cache-checkpoint identity, offline/readiness tests:
- Existing service/bot/asset checks actually executed and results:
- Owner audible acceptance, date and exact verdict:
- Cutover time, no-active-session evidence and affected service(s):
- Actual deployed source/image/config/checkpoint/state identities:
- Health/smoke evidence, or explicitly not deployed:
- Rollback identities and verified restoration if used:
- Safe files committed/pushed; remote branch equality; VPS source sync:
- Remaining blockers; do not infer clone acceptance from health alone:
