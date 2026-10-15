# Ei Point Implementation Update

**Updated:** 2026-10-15
**Repository:** `https://github.com/xyanncat/Ei-point.git`
**Branch under development:** `main`

This file records the implementation and documentation work made from the Ei Point build requirements and the user clarifications in this task. It is a status report for the project assets folder; the original build plan and skills archive remain source inputs and were not rewritten.

## User decisions reflected in the implementation

- Cyrene `/tts` voice chat reads eligible text messages posted in the joined voice channel. It does not transcribe spoken audio.
- Cyrene has a `/translate` command using the local Hy-MT2 model. The source language is optional (automatic detection); the user selects the target language.
- The repository remains designed for the documented hybrid deployment. The local model services run alongside the bot stack on the VPS; this does not mean the project has already been deployed.

## Implemented code and runtime changes

### Cyrene translation

- Added `/translate` with required text and target-language fields and an optional source-language field.
- Added input validation: a 500-character text limit, normalization, supported-language allowlist, and rejection of likely credential material.
- Added a bounded single-worker request queue, queue capacity, 60-second deadline, response-size limit, and clear user-facing busy/unavailable messages.
- Calls a local OpenAI-compatible Hy-MT2 endpoint through `HY_MT2_URL`; the application does not need an external translation API key.
- Added the Hy-MT2 service image definition and model provisioning utility. Provisioning requires a pinned model revision, stores a SHA-256 digest, and refuses to overwrite an existing model directory.

### Cyrene voice chat and persona

- `/tts` voice-chat mode reads cleaned text messages from the joined voice channel and plays them sequentially. It filters links, markdown links, emoji, mentions, and stage directions, with per-user cooldown and queue limits.
- Added Cyrene persona loading from a mounted local memory file. It selects core identity, behavior, canon, voice, relationship, intent, and boundary guidance; excludes sample replies and reference links; and fails closed for a missing section or a prompt over 16 KiB.
- The persona guidance is supplied to Cyrene’s mention replies and the `/ask` route. The persona prompt is included in the AI token reservation estimate.

### Deployment and operations

- Added the Hy-MT2 service to local Compose configuration with a read-only model mount, non-root user, dropped capabilities, no-new-privileges, loopback-only diagnostics port, health check, and CPU/memory limits.
- Updated release manifest/roster, deploy, health, and rollback flows to handle local model services while retaining rollback behavior for older release manifests.
- Added Hy-MT2 operations documentation covering model preparation, runtime configuration, health checks, resource expectations, and release behavior.

### Documentation

- Updated the README, bot command catalog, bot identity documentation, feature matrix, product command/runtime specification, release operations guide, and Qwen TTS operations guide.
- Added the detailed command and runtime behavior for Cyrene `/translate`, voice-chat reading, persona configuration, and local Hy-MT2 operations.

## Verification and review status

- The repository’s full `pnpm test` command completed successfully: all workspace builds, package tests, phase checks, operations/runtime tests, and backup checks in that script passed.
- After the final persona-section and `/ask` prompt wiring fixes, the AI bot TypeScript build passed and its focused tests passed: **9 passed, 0 failed**.
- The full test run used pnpm 9.12.0. The installed Node.js was 24.21.0 while the repository declares 24.8.0, so pnpm emitted an engine-version warning.
- `git diff --cached --check` reported no whitespace errors; Git emitted only LF-to-CRLF conversion notices for some files.
- A read-only code review found no verified Critical or Important findings. CodeRabbit’s review findings were checked: the rollback concern was a false positive; persona identity section 3 and `/ask` persona propagation were corrected; the TTS text-filter and loopback-port documentation findings had already been addressed.
- A fresh CodeRabbit review completed after the persona fixes. It flagged a possible late rejection from the translation worker after `Promise.race` times out. This was checked against the current implementation: `Promise.race` attaches fulfillment and rejection handlers to every input promise immediately, so a later worker rejection is already handled; no change was needed.
- An exploit-validated Strix scan was unavailable because the `strix` and Docker commands were not installed in the environment. No exploit-validated security scan is claimed here.

## Remaining work and acceptance gates

The source implementation and documentation do not by themselves prove production readiness. The following items remain open until exercised in the intended environment:

- Provision the pinned model weights on the target Linux VPS, confirm available CPU/RAM and inference performance, build the service images on Linux, and verify model health and translation quality on the actual host.
- Configure and test the Discord application’s intents, permissions, guild/role controls, voice playback, message reading, `/translate`, and model-unavailable behavior in a staging server.
- `/search` is still explicitly unconfigured and must not be described as operational until an approved search source is configured and tested.
- Run staging and live deployment acceptance, including release rollback and backup restore checks. Complete the plan’s soak/monitoring period and any remaining legacy behavior parity acceptance.
- Payment-provider sandbox credentials and end-to-end payment reconciliation remain separate deployment/acceptance requirements; this update does not assert that real payment processing is configured or verified.

## Git publication status

The implementation was committed and pushed to `origin/main` as `16e16ce` (`feat(ai): add local Cyrene translation and voice chat`). No production deployment was performed. The original build plan and skills archive were not edited.
