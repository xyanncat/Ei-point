# Cyrene /speak: directly playable media inside the Components V2 Container

---

@verification-before-completion @systematic-debugging @deep-research @ponytail @discord-bots

Change Cyrene's /speak result so the user presses Play inside the Discord Components V2 Container and hears the generated speech without manually downloading a WAV. The current result displays Cyrene artwork and a cyrene.wav File component with a download-style tile. Replace that presentation with actually playable in-app media while retaining the current Cyrene identity and container layout.

This task concerns delivery/presentation of already generated speech. Preserve the TTS model, reference voice, translation, text-reading voice sessions, permissions, visibility, input bounds and queue controls. Do not rerun the VPS benchmark or change CPU/model configuration. Respect any earlier queued task and do not overlap deployments or interrupt active sessions.

## Skills

Read the actual available skill instructions; do not claim a skill was invoked merely because its name appears here. Report unavailable skills honestly and use an equivalent workflow.

- @deep-research @discord-bots: verify current official Discord component/media/attachment rules and the installed discord.js API before choosing the payload.
- @systematic-debugging: trace /speak -> synthesis -> sendAudio -> createVoiceCard -> shared reply wrapper -> final Discord upload/edit payload.
- @ponytail: reuse the existing media/FFmpeg tooling and make the smallest complete change; no custom player server, new hosting service or speculative framework.
- @ui-design-systems @accessibility: preserve a clean, legible card with useful native controls and a descriptive media label.
- @verification-before-completion: verify actual client playback, not only serialized JSON or successful upload.
- @release-management: deploy only affected services safely if available and necessary.

## Capability constraint and chosen implementation

Do not invent an AudioPlayer component, HTML audio support, or an AudioBuilder. A File component alone is not evidence of a native audio player. Do not assume placing a WAV/MP3 in a Media Gallery makes it supported playable media. Check the current official references:

https://docs.discord.com/developers/components/reference
https://docs.discord.com/developers/resources/message

If Discord now offers a documented native audio-only player that works inside a V2 Container, verify it using the installed API and prefer it. Otherwise implement this supported workaround: package the generated speech with a still Cyrene artwork frame as a short MP4, then display that attachment as a video in a Media Gallery nested inside the same Container. The user will hear the audio through Discord's native media Play controls. Be explicit in the report that it is a still-image video, not an audio-only component.

Do not use external playback pages, download-link buttons, voice-channel joins, a fake Play button, autoplay promises, user tokens, undocumented endpoints, or voice-message flags whose compatibility with V2/interactions has not been established. The desired result is playback within the message. Discord may stream/buffer media internally; the requirement is no manual file download, not zero network transfer.

## Implementation

1. Inspect current source and applicable AGENTS.md. Relevant earlier entry points were apps/bots/ai/src/index.ts sendAudio and packages/modules/bot-ui/src/index.ts createVoiceCard. Recheck locations and callers. Avoid changing unrelated bots' file responses.
2. Reuse the already synthesized audio bytes. Do not run synthesis again to create the video. Use the existing approved local/static Cyrene artwork where possible; avoid fetching arbitrary URLs or adding an external data service. Reuse a validated frame per artwork revision if useful.
3. Use the installed FFmpeg through argument-array process invocation, not shell-concatenated user text. Produce a client-compatible MP4 with a still frame and audible speech: H.264 video, AAC audio, compatible pixel format, correct duration, and fast-start metadata. Probe actual codec availability; do not assume every image has every encoder. Use a low-resolution, low-frame-rate still presentation suited to this CPU-limited VPS; never render high-FPS animated artwork for this task.
4. Bound conversion concurrency to one, queue admission, subprocess lifetime, input/output bytes, dimensions and duration. Use unique owner-private temporary paths, cleanup after success/failure, handle timeout/shutdown, and retain useful secret-safe errors. Conversion must not block the Node event loop or exhaust model/bot resources. Never put user text in filenames or command strings.
5. Upload the actual resulting MP4 as cyrene.mp4 and reference attachment://cyrene.mp4 in a type-12 Media Gallery inside the type-17 Container with IS_COMPONENTS_V2. Ensure MIME/container/extension match real bytes. Keep the upload and attachment reference consistent through deferred editReply and the shared wrapper. Do not add a redundant WAV File tile or a duplicate giant artwork panel; the video already contains the art.
6. Preserve current branding, configured colour policy, mention restrictions and public/private response policy. A short heading such as 'Cyrene · Voice' and 'Press Play to listen' is sufficient. Controls should be Discord's native media controls, not decorative buttons.
7. Respect the actual interaction/channel attachment-size limit and existing service bounds. If conversion/upload fails, show a clear bounded error; do not silently return a download-only tile and claim success. Never regenerate audio or upload repeatedly without a bounded policy.

## Verification and rollout

- Use short synthetic audio or a fixture for conversion tests; avoid loading another model or repeatedly invoking production inference.
- Verify FFprobe sees the intended audio/video streams, duration, codecs and dimensions; check nonempty audio and size bounds.
- Test the final Container/Media Gallery attachment reference, upload metadata, idempotent wrapper behavior, deferred reply, conversion errors, cleanup and bounded process termination.
- Build/typecheck affected packages under pinned tools and inspect the final diff.
- Deploy only what is necessary using the established workflow. Do not restart an active voice/music session or any model service for this presentation change.
- Verify /speak in the approved test guild. Confirm the MP4 appears INSIDE the Container, pressing native Play produces audible speech in Discord without a Save/Download step, and the full clip can be heard. Check desktop/web and mobile when available. A 200 response, valid MP4, screenshot of a poster or passing unit test alone does not establish playback.
- If client access is unavailable, request the exact owner Play test after backend checks and mark audible/client acceptance pending. Do not claim cross-client support without observing it. Confirm existing /tts reading and /leave behavior are unaffected without disturbing a live session.

Write a concise report with changed files, tests, conversion overhead and output size for the fixture, deployed revision, observed Discord playback, client limitations and rollback. Distinguish the still-image-video workaround from true audio-only support. Do not claim this accelerates TTS inference or improves the model's speech quality.
