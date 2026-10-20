# Private Cyrene dataset contract

## Inventory first

Existing parent inputs:

- `[Cyrene (Honkai star rail) ]Ah, t......ther_.mp3`: known conditioning/reference asset; determine its actual location on the VPS. Preserve the original bytes.
- `Cyrene_Chat_Roleplay_Memory.md` and `Cyrene_TTS_Voicebot_Memory_Updated.md`: style/behavior context, not acoustic training examples. Do not infer transcripts from their contents.

Use only recordings the owner is authorized to use for this adaptation. Record source and permission basis privately; do not scrape a voice corpus or publish voice assets as part of this task. Existing tracked private audio does not authorize adding copies, committing derived data or rewriting Git history.

Create private `sources.csv` with columns:
`source_id,path,sha256,duration_seconds,speaker,language,permission_basis,session_id,quality_notes`.
Create private `clips.jsonl` with fields:
`id,source_id,session_id,path,start_seconds,end_seconds,text,speaker,language,split,sha256,reviewed`.
These are project inventory formats; write and test an explicit converter to the exact pinned upstream aligned-manifest format. Do not feed this schema directly to its trainer.

## Quality and preparation

1. Decode with a pinned tool, inspect channels, duration, sample rate, clipping, silence, background music/effects, overlap and changes of speaker. Listen, do not rely only on statistics.
2. Preserve raw files. Write processed mono PCM at the verified codec sample rate (current inference is 24 kHz) into the private run area. Resampling does not recover missing detail. Avoid aggressive denoising, pitch shifting, speed changes or long silence trims that alter Cyrene's natural delivery.
3. Prefer complete utterances, roughly 2–12 seconds for initial CPU experiments; retain quiet consonants and natural onset/ending. Reject music-heavy or multi-speaker sections unless clean separation is demonstrably good. Do not invent missing syllables.
4. Transcribe exactly what is spoken, including meaningful nonverbal utterances only if supported by the tokenizer/training format. Use ASR only to draft; review against the actual audio. Never assign arbitrary persona lines to an unrelated recording.
5. Use the pinned upstream alignment requirements; inspect boundaries against waveforms and listening. Any additional aligner model runs within the same resource envelope. Keep tokenizer IDs and vocabulary from the base model.
6. Deduplicate by hashes, overlapping source intervals and near-duplicate audio/text. Splits must be grouped by original recording/session BEFORE segmentation, with disjoint dialogue lines where possible. Never split the same recording into near-identical train/test clips.

## Quantity gate

Count unique usable minutes, distinct utterances and phonetic/style coverage, not augmented file count. If only the known approximately 15-second clip is available, label `insufficient_data`; do not claim a valid held-out experiment or attempt a production fine-tune.

As a project collection target, aim initially for at least 20–60 minutes of clean, varied single-speaker speech and preferably more if coverage is narrow. This is an engineering target, NOT a published Pocket minimum or a guarantee. An initial 80/10/10 source-group split is reasonable only when there are enough independent recordings; otherwise collect independent validation/test material instead of manufacturing independence. Report actual counts and limitations.

Cover gentle and neutral delivery, greetings, questions, long and short sentences, names, numbers, contractions and punctuation. Do not train only one breathy emotional line and expect all speech to generalize. Avoid mixing actors or languages without a separately justified plan. English adaptation does not automatically add other-language pronunciation.

## Outputs and privacy

Private outputs: source/clip inventory, reviewed transcripts, aligned train/validation/test manifests, raw/processed audio, latents and QA findings. Git outputs: preparation code, schema, aggregate statistics, hashes of manifest files and sanitized provenance summary. No private utterance text, audio or voice state in public reports. Hashes permit integrity checks; they do not make private content safe to publish.
