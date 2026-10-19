# Cyrene `/speak` — inline playable media in the Components V2 card

Date: 2026-10-20 (owner local). VPS clock during work: **2026-10-19T22:55–23:10Z**.
Status: **backend implemented, deployed and verified; Discord playback/audibility is pending the
owner's client check.** No model, TTS, CPU, database or `/tts` reading behaviour changed.

## Capability verification (official sources)

- `https://docs.discord.com/developers/components/reference` — component type 12 **Media Gallery**
  displays images and other media (media items carry width/height “if image or video”); type 13
  **File** displays an attached file (download tile); **no native audio-only player component
  exists**. Attachments in Components V2 are hidden unless exposed by a component.
- `https://docs.discord.com/developers/components/using-message-components` — `IS_COMPONENTS_V2`
  (`1<<15`) is required for V2 messages; `content`/`embeds` are disabled.
- Therefore the supported workaround was implemented: the generated speech is packaged with a
  still Cyrene artwork frame into a short H.264/AAC MP4 and exposed in a Media Gallery inside the
  Container. This is a **still-image video with audio**, not true audio-only playback.

## Implementation

- `apps/bots/ai/src/voice-video.ts` (new): bounded MP4 conversion using FFmpeg argument arrays
  (no shell, no user text in paths):
  - H.264 (`libx264`, veryfast, stillimage, CRF 30, yuv420p), AAC 96 kbps/48 kHz,
    `-shortest`, `+faststart`, 720 px wide, 10 fps, duration bounded by the real WAV length
    (max 300 s).
  - One conversion at a time, queue admission capped at 2, 90 s subprocess timeout, 8 MiB output
    bound, private `mkdtemp` paths, cleanup on success/failure, encoder probe (`libx264`+`aac`)
    cached.
- `apps/bots/ai/src/index.ts`: `sendAudio` reuses the **already synthesized** bytes and uploads
  `cyrene.mp4`; the card is text + Media Gallery (`attachment://cyrene.mp4`) with an alt
  description. On conversion failure it sends a clear bounded error card (no download tile).
- `packages/modules/bot-ui/src/index.ts`: `createVoiceMediaCard` (type-17 Container, type-12 Media
  Gallery, no type-13 File, no accent colour). The old `createVoiceCard` WAV helper was removed.
- `apps/bots/ai/Dockerfile` + `.dockerignore`: bake `project assets/bots/Cyrene/embed.png` into
  `/app/assets/cyrene-art.png` without exposing the rest of the assets.
- `/tts` voice-channel reading, model services, permissions, visibility and the shared wrapper
  are untouched.

## Tests and build

- `@ei-point/module-bot-ui`: **9/9 pass**, including a new test asserting type-17 + type-12
  (`attachment://cyrene.mp4`), **no type-13**, no accent colour, flags `32768`.
- `@ei-point/bot-ai`: **24/24 pass**, including argument bounds, WAV duration parsing, encoder
  parsing, serialized queue + third-admission rejection, and typed bounded failures
  (`empty-audio`, `artwork-missing`, `voice-too-long`).
- `tsc` build exit 0 for both packages; no shell interpolation; no user text in filenames.

## Deployed and live verification

- Deployed revision **`d522497`**; only `bot-ai` was rebuilt/recreated after confirming
  `ai.voice_leases = 0`. Model services, PostgreSQL, web/api/nginx/workers and Robin were not
  restarted. Image `sha256:4b023d06ae65…`; bot healthy and ready.
- Image checks: `/app/assets/cyrene-art.png` present (51,171 bytes, owned by `node`); FFmpeg
  reports `libx264` and `aac`; `/tmp` writable.
- Fixture conversion inside the running container (synthetic 30 s sine WAV, **no TTS inference**):
  - conversion **0.71 s**, output **442,300 bytes** (≈432 KiB);
  - ffprobe: H.264 720×406, video **30.1 s**; AAC audio **30.0 s** (bounded by the speech,
    no long frozen tail);
  - deployed card serialization: `container17 true, gallery12 true, file13 false, mp4 true,
    flags true`.
- Health after: bot-ai healthy, 0 active voice leases, no error/failed log lines in the window;
  13 containers running. No model or database restart occurred.

## Pending acceptance (owner client)

- Run `/speak text:"Hello there."` in the approved dev guild.
- Confirm the card shows the **video inside the Container** with native Play controls (no Save
  or Download tile), press Play, and confirm the full clip is audible; check desktop/web and
  mobile if available.
- Until that is observed, playback is **not** claimed. A valid MP4 and serialized JSON are not
  proof of client playback.

## Limitations and rollback

- This is a still-image video workaround, not a native audio-only component; Discord may buffer
  or stream the MP4 internally.
- Conversion adds bounded CPU work (~0.7 s for 30 s of audio on this host) and a file of
  ≈0.4–0.6 MB for typical clips, well under the 8 MiB cap and the channel upload limit.
- Client rendering of inline video inside V2 containers may vary by client version; cross-client
  support was not observed here.
- Rollback: revert `eff1e04`/`7dc175f`/`d522497` and rebuild `bot-ai`; the previous image remains
  available. `/tts` and model behaviour are unaffected either way.

## Skills read

The five defaults (`verification-before-completion`, `systematic-debugging`, `deep-research`,
`ponytail`, `discord-bots`) plus `ui-design-systems`, `accessibility`; `release-management`,
`docker-best-practices` and `runbooks` were read earlier in the session. No unavailable skill was
claimed.
