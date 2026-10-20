# Evidence and version boundaries

Checked 2026-10-20. Upstream `main` is mutable: the execution agent must record a concrete source commit and verify it against the installed package/model. Links are research references, not commands to upgrade production.

- [Official training guide](https://github.com/kyutai-labs/pocket-tts/blob/main/training/README.md): documented training workflow, data/evaluation and compute context. Do not apply its large-corpus scratch-training quantities as a proven minimum for single-speaker adaptation.
- [Official fine-tuning config](https://github.com/kyutai-labs/pocket-tts/blob/main/training/configs/finetune.yaml): supplied recipe uses an English 24-layer teacher, not a validated direct-six-layer Cyrene recipe.
- [Depth distillation config](https://github.com/kyutai-labs/pocket-tts/blob/main/training/configs/depth_distill.yaml): distinct teacher/student route; not requested here.
- [Device initialization](https://github.com/kyutai-labs/pocket-tts/blob/main/training/distributed.py): current source explicitly gates CPU behind `POCKET_TTS_ALLOW_CPU=1`; this escape hatch is not a CPU performance guarantee.
- [Model builders](https://github.com/kyutai-labs/pocket-tts/blob/main/training/modules/builders.py): inspect actual pretrained loading, codec freezing and objective construction rather than assuming a generic LLM trainer works.
- [Training loop](https://github.com/kyutai-labs/pocket-tts/blob/main/training/train.py): inspect backward, optimizer, checkpoint and termination behavior in the selected revision.
- [Pocket model repository](https://huggingface.co/kyutai/pocket-tts): access conditions and weight lineage; do not strip attribution when naming the adaptation Cyrene.

Local evidence: `docs/operations/pocket-tts.md`, `docs/audits/2026-10-20-cyrene-pocket-tts-migration.md`, current Pocket service code and Compose. Reverify deployed facts; this pack does not assert current VPS inspection.

Experimental choices in this pack: direct six-layer adaptation, data collection targets, conservative CPU budgets, step/time caps and promotion thresholds. They are project decisions for a bounded experiment, not official Pocket promises. No guaranteed voice match, training duration or throughput is claimed.
