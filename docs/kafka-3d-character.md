# Kafka 3D character — asset report, animation configuration and verification

Owner task 2026-10-19. Model: `D:\3d\star_rail_-_kafka.glb` (original preserved
untouched). Working copy: `apps/dashboard/public/art/kafka3d/star_rail_-_kafka.glb`
(byte-identical, SHA-256 `880BE2BAF2AB28FA6EFA0A4779635A8297E01DD6F070D1057636F4D568B1A35F`).
Preview: `/dev/kafka-character` (add `?debug=1` for skeleton + bone probes).
Inspector used for every structural claim: `scripts/inspect-kafka-glb.mjs`.

## 1. Asset verification (claims re-checked against the file)

| Claim (prior inspection) | Verified result |
| --- | --- |
| 5,792,844 bytes; glTF 2.0; 7 meshes; 1 skin / 376 joints; skin attributes present | ✅ all correct (Sketchfab-15.49.0 export) |
| Five embedded PNGs: 3 × 2048², 2 × 1024² | ✅ correct; all opaque RGB (no alpha channel) |
| KHR_materials_unlit on materials | ✅ all 7 materials unlit; `material_6` is untextured black, doubleSided |
| No animation clips; no morph targets | ✅ confirmed (0 animations, 0 primitive targets) |
| “Some mesh names appear garbled” | Corrected: **all 395 node/joint names are ASCII-readable**; only the 4 CJK mesh names are mojibake in ASCII consoles. No obfuscated names. |
| Textures missing / invalid data | None. Materials 1 and 3 share texture 1; unlit materials ignore lights by design. |
| Scale / orientation | Y-up, facing +Z, feet at y=0, height 20.45 units (glasses tip); bind pose is a T-pose. |

Rig anatomy (world positions from the inspector; hierarchy-verified, not
name-guessed): `_rootJoint → Hips_04 → Spine_05 → Chest_06 → Neck_07 →
Head_08`; full arm chains (`shoulder → arm → elbow → zHandTwist → wrist` +
1–3-segment fingers); 19 named hair chains under `Head_08` (bangs A–I, side
locks J/K/W/VR/VL/Z, big back mass `HairB*` with `RB`/`LB` sub-chains, side
strands `Yb_*`/`Zb_*`); a 176-joint coat/drape fan (`Wt_{depth}_{chain}_{uid}`,
17 chains rooted on `Chest_06`, fanning x ±3.4 down to y≈9.8); sleeve chains
(`Zxz_*`/`Yxz_*` from the arms, `Xk_*`/`Zxk_*` cuffs from the elbows, `Xj_*`
front flap from `Spine_05`, `Ys_*` back drape from `Chest_06`).

## 2. Capability table

**Supported by this asset (implemented)** — breathing (hips/spine/chest/shoulders),
idle head/neck drift, pointer head-tracking with spring return, secondary
follow-through on 19 hair chains + 7 coat chains + 3 sleeve chains, natural
idle stance from the T-pose bind, pause/quality/framing controls.

**Supported after code integration (implemented)** — lazy loading, static
poster fallback, off-screen/hidden suspension, DPR clamp by quality, reduced
motion default-pause, one automatic recovery on WebGL context loss, full
renderer disposal on unmount.

**Requires additional animation/asset editing** — blinking: **no eyelid bones
and no morph targets exist**; the face is textured. Expressions: same. Eye
tracking: the two eye joints (`Eye_L_010`, `Eye_R_09`) exist but a 25° probe
did not deform the eyeballs (verified with before/after close-ups) — the eye
layer is therefore OFF (`eyes: { yaw: 0 }` in `DEFAULT_ANIMATOR_CONFIG`) until
the asset binds separate eye meshes to those joints.

**Not yet verified** — animation clips/retargeting (none exist in-file; none
sourced — no licensing detour taken). Hair “physics” beyond the implemented
procedural damped follow-through (no simulation claimed). Root motion (a
standing idle does not need it).

## 3. Animation configuration (`components/kafka3d/animation.ts`)

- All rotations are `rest * delta`; rest captures happen after the idle base
  pose, so no frame-to-frame accumulation and no drift.
- Delta-time based; `dt` clamped at 50 ms by the engine.
- Every driven angle is clamped (`secondary.clamp` 4.6°, tracking 7.2°/4°,
  head idle ≤1.4°). Driven set is explicit; ~40 bones move, never “all 376”.
- Layers: breathing (period 4.6 s), idle drift (three incommensurate sines),
  pointer tracking (critically damped spring, ω 8.5, head 72% / neck 28%),
  secondary motion driven by the head's per-frame angular delta (ω 5.4,
  clamped impulse) — classical follow-through, no clipping observed at
  40° test amplitudes.
- Idle base pose: world-axis definitions converted through each bone's live
  world basis at load (`applyIdleBasePose`) — arms 68° down + 7° forward,
  elbows 13° forward. `resetPose()` returns to this stance, not the T-pose.

## 4. Component boundary (`components/kafka3d/kafka-character.tsx`)

| Prop | Meaning |
| --- | --- |
| `src` | model URL (default bundled GLB copy) |
| `posterSrc` | static fallback shown while loading / on failure |
| `quality` | `"high" \| "medium" \| "low"` — DPR ≤2/1.5/1 + antialias budget |
| `framing` | `"full" \| "portrait"` composed cameras |
| `active` | render only while true (viewport gating input) |
| `tracking` | pointer tracking on/off |
| `controls` | visible pause control (default on) |
| `debug` | expose `window.__kafka3d` engine probes (preview only) |
| `onLoaded` / `onError` | lifecycle callbacks |

Bone mapping (`bone-map.ts`), animation (`animation.ts`) and renderer lifecycle
(`engine.ts`) are separate from all site/API logic; rendering needs no
privileged APIs. The 3D loop is the only writer of `bone.quaternion`; site CSS
and page code never touch scene transforms (no GSAP/Motion interaction).

## 5. Performance & accessibility (implemented)

Lazy start on approach (IntersectionObserver, 320 px margin) · reserved layout
(caller sizes the box; poster first) · off-screen and `document.hidden`
suspension · DPR clamp by quality + antialias off at low · reduced-motion
starts paused with a visible opt-in control · visible pause control
(`aria-pressed`) · one-shot context-loss recovery then honest fallback ·
`renderer.dispose()` + `forceContextLoss()` + geometry/material/texture
disposal + observer/listener removal on unmount · no automatic audio ·
pointer listeners on the character area only (no scroll/keyboard capture) ·
zero React state changes per animation frame (only lifecycle + user intent).

## 6. Texture verdict

Kept as authored; **no upscaling performed** (and none needed): the 2048²
body/clothes sheets and the 1024² face sheet hold up at the intended display
sizes, including a portrait close-up of the face in the browser. Unlit
materials are rendered with `NoToneMapping`/sRGB output — the painted look is
faithful to the source.

## 7. Verification log (browser, not compilation)

- Headless Edge (SwiftShader) and the desktop browser (Intel UHD via
  ANGLE/D3D11), Windows 11, 2026-10-19.
- Production build measured live: **60 fps sustained (avg 16.68 ms, p95
  16.9 ms)** at 884×611 canvas, DPR 1, ~30 s sample. First frame ≈1 s
  (shader compile + 5.8 MB texture upload); later frames ≪ budget. No
  universal-fps claim — this is one integrated-GPU desktop configuration.
- Idle stance, breathing, head drift, pointer tracking (≈5–6° left/right),
  smooth return-to-idle, hair/coat follow-through, pause toggle, reset pose:
  visually verified via scripted probe screenshots (`?debug=1`).
- Eyes probe: no deformation → capability reported missing (above).
- Fallback: GLB request blocked → poster + "3D character unavailable" +
  friendly message, no pause control.
- Reduced motion emulated → starts paused, offers opt-in.
- Mount/unmount cycle ×3 (dev) and away/back (production): exactly one canvas
  each time, zero orphaned canvases, no page errors.
- Mobile 390 px: zero horizontal overflow; stacked layout.
- Gates: dashboard `typecheck` clean; production `build` clean; existing
  browser suite **16/16** green (public site, checkout flows, staff workspace
  untouched by this work).

## 8. Missing asset capabilities (precise)

1. **Blinking** — no eyelid joints, no blend shapes; needs rigging work
   (eyelid bones or morph targets + export).
2. **Eye tracking** — eye joints exist but do not drive the eyeballs; needs
   the eye meshes re-bound to `Eye_L_010`/`Eye_R_09`.
3. **Expressions** — no facial control beyond eye joints; needs blendshapes
   (e.g. 52 ARKit-style or a game-standard set).
4. **Hand animations** — full finger chains exist (unused; idle needs none).
5. **Hair/cloth simulation** — implemented motion is procedural follow-through,
   not physics; a simulation pass is optional polish, not a gap to fake.

## 9. Integration recommendation

The approved hero stays exactly as-is. The scene cannot yet promise
“blinking” quality, so it should not replace the hero illustration; it is
demonstrably strong as an interactive showcase. Recommended next step when the
owner wants it live: a **character showcase section** (own band below the
hero, poster-first with the component lazy-starting on approach) using
`<KafkaCharacter framing="full" posterSrc="/art/kafka-hero.png" />`.
Open items for that step: asset provenance/licensing review for public use,
repo size (5.8 MB GLB — consider object storage/CDN), and the rigging work in
§8 if blinking/expressions are required before launch.
