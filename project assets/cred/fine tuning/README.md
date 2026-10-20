# Cyrene six-layer Pocket TTS fine-tuning handoff

Start with **OPENCODE_PROMPT.md**. This folder is the implementation handoff, not a trained model or a claim that training will work on the VPS.

## Intended result

A private, single-speaker six-layer checkpoint named **Cyrene**, with an improved Cyrene timbre and delivery on previously unseen text. The public service exposes only Cyrene. Preserve normal pronunciation and fast CPU inference. Keep upstream provenance in technical metadata and notices.

Fine-tuning changes weights. Exporting a reference voice state, changing tempo, removing voice presets, changing a persona prompt or renaming a service does not. TTS learns speech acoustics; character memories belong to the separate chat system. Single-speaker specialization cannot prove that all other voice capability has been erased from pretrained weights.

## Contents

| File | Purpose |
|---|---|
| OPENCODE_PROMPT.md | Paste into OpenCode; skill routing, execution boundaries and deliverables |
| IMPLEMENTATION_PLAN.md | Ordered engineering tasks and evidence gates |
| DATASET.md | Source inventory, transcription, alignment, quality and leak-free splits |
| EXPERIMENT.json | Project experiment contract; deliberately NOT an upstream trainer config |
| EVALUATION.jsonl | Unseen synthesis texts; no reference recordings or training labels |
| REPORT_TEMPLATE.md | Feasibility, experiment, quality, performance and deployment record |
| SOURCES.md | Primary references and verified versus experimental distinctions |
| .gitignore | Keeps local training data, weights and experiment output out of Git |

## What is known locally on 2026-10-20

The tracked operations guide and migration audit describe Pocket 3.3.0, a six-layer English model, revision `983151f13aaeab1b13c1e5e3c2c383d49a9edf3f`, one inference thread and tempo 0.90. They record the failed 24-layer experiment and a reference of about 15.569 seconds. These are repository records, not a fresh inspection of the VPS. The execution agent must inspect the live system.

The available reference MP3 is useful for conditioning and comparison. A single 15-second clip does not establish a diverse fine-tuning dataset. Audit other authorized recordings before deciding whether training is meaningful. Do not duplicate that clip into a fake dataset.

## Execution boundaries

No automatic training starts from this folder. No runtime dependency or model asset is changed by these documents. Run experiments in a separate private directory and environment, with hard resource and time limits. Long training is conditional on real data, compatible training code and a successful CPU feasibility pilot; being able to run inference is not evidence of training practicality.

The requested route is direct six-layer adaptation. Do not restore the deleted 24-layer model or add another engine. If direct adaptation cannot be made compatible within a small, documented patch, report the exact blocker and leave production working.
