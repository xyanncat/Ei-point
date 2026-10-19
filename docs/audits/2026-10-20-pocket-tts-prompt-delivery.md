# Pocket TTS migration prompt delivery -- 2026-10-20

Scope: prompt/documentation only. No engine migration, inference request, dependency installation, media rendering or service restart was performed by this task.

## Deliverable

`project assets/cred/EI_POINT_POCKET_TTS_MIGRATION_PROMPT.md` directs the VPS agent to migrate Qwen3-TTS to Pocket TTS using the owner's MP3 for voice conditioning and both supplied Markdown files as product/reference guidance. It preserves bounded persona handling, voice-channel text reading, local Hy-MT2 translation, current playable Components V2 media, safe deployment and rollback. It requires measured speed/quality on the actual guest rather than assuming the vendor's CPU results transfer.

## Inputs and checks

- All three named owner files were confirmed present. The TTS brief and roleplay headings were inspected. This task did not listen to or generate audio and does not claim voice similarity.
- The official Pocket repository and model card were consulted for CPU focus, cloning/state reuse, supported-language/API considerations and separate code/model license checks.
- The prompt was checked for the five default skill mentions, exact file names, 16 KiB persona bound, Hy-MT2 preservation, incremental-playback acceptance, branch synchronization and rollback.
- Only this prompt and audit are staged for publication; reference audio, voice states, weights, persona files and runtime configuration are excluded from this change.
- Prompt-only validation and staged secret scanning apply; application tests are not claimed as rerun for this documentation change.

## Source and deployment state

- Starting local source was `02701c2`; main was fast-forwarded to the already pushed `7894bcf` before authoring, preserving the newer translation tuning.
- The delivery revision is the Git commit containing this report; remote main and feat/completion-plan are to be published together and their identities verified after push.
- VPS checkout revision, running image IDs and live health were not inspected in this task: direct authorized SSH access is unavailable here, and the browser terminal was previously blocked by browser security policy. They must not be inferred from local or remote Git refs.
- Source-only VPS pull to the delivery revision remains pending authorized VPS access. No rebuild/redeploy is needed for these documents, and no model/voice service should be restarted for this source-only synchronization.
- Pocket migration and its deployed image/health/latency evidence remain future work for the agent executing the prompt.
