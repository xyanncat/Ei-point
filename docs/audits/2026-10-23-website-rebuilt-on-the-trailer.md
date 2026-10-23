# Website rebuilt on the trailer — 2026-10-23

Source revision: `f4d5cf6` on `main`, mirrored to `feat/completion-plan`.

## What changed

The public website was rebuilt so the trailer **is** the interface. The full
149.3 second film runs full-bleed behind every route, the soundtrack loops
with it, and the page is the content layer. Every static illustration, the
three.js character rig and the old twenty-five route staff workspace were
removed.

### The film

| File | Format | Size | Notes |
| --- | --- | --- | --- |
| `apps/dashboard/public/media/film-1080.mp4` | H.264 high, 1920x1080, CRF 25, `+faststart`, no audio track | 90.34 MB | every browser |
| `apps/dashboard/public/media/film-540.mp4` | H.264 main, 960x540, CRF 30, `+faststart` | 24.59 MB | phones (`max-width: 820px`) |
| `apps/dashboard/public/media/loop.mp3` | 128 kbps, trimmed to 149.300s | 2.85 MB | the soundtrack |
| `apps/dashboard/public/media/posters/*.jpg` | JPEG | 0.60 MB | 9 frames, the still before the film paints |

The soundtrack is trimmed to the film's exact length so the picture and the
music stay in step on every loop. The source trailer had its `mdat` atom
before `moov`, so it could not start playing at all in a browser; every web
copy is `+faststart`.

Quality was checked frame for frame against the source: the 720p/CRF 26
encode and the 1080p/CRF 25 encode are visually indistinguishable from the
original at 100%. VP9 was encoded and rejected — CRF 31 produced 98 MB for
this content, larger than the H.264 original.

Total media added to the repository: **118.4 MB**. GitHub warns that
`film-1080.mp4` is above the recommended 50 MB, but it is under the 100 MB
hard limit and the push succeeded.

### The pages

| Area | Routes |
| --- | --- |
| Public | `/`, `/services`, `/services/[sku]`, `/about`, `/docs`, `/terms`, `/policy`, `/membership`, `/referrals`, `/cards`, `/verify`, `/login` |
| My account | `/account/servers`, `/account/services` (admin and master only), `/account/orders` |

`/help` now redirects to `/docs`. The home page is the film's eight beats,
with the copy in each scene written from that beat, and the crop of the
frame walks down the source as the reader scrolls.

### The role ladder

`user < admin < master`, held in `DASHBOARD_ADMIN_IDS` and
`DASHBOARD_MASTER_IDS` (`apps/api/src/roles.ts`, shared with the bots through
`@ei-point/contracts`).

- **admin** (`733513636269785120`) — the services tab: price, wording, add and
  remove catalogue entries, plus every purchase on the platform.
- **master** (`1479589523426902208`) — every approved server, not only the
  ones they belong to; may edit any of them; may remove a bot from a server
  (`DELETE /api/master/guilds/:guildId/bots/:botKey`); and no bot refuses a
  master command, in either the commerce or the community bot.

The catalogue is now operator owned. `commerce.catalog` gained the
descriptive fields the public site shows (migration
`infra/postgres/migrations/020_operator_catalogue.sql`), and the services
page reads the live values, falling back to the archived definitions when the
API is unreachable.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm build` | all workspace packages built |
| `pnpm typecheck` | clean across every package |
| `pnpm test` | 153 tests, 0 failures |
| `pnpm exec playwright test` | 28 browser tests, 0 failures |
| `node scripts/check-feature-coverage.mjs --mode structural` | 179 rows, all mapped |
| `node scripts/check-openapi-sync.mjs` | contract matches |
| Secret scan of the change set | no secret-shaped assignments in 49 changed text files |

Browser coverage includes the film itself: it is full bleed, it loops, it
carries the full 149 seconds, there is no play, pause or mute control
anywhere in the interface, and `prefers-reduced-motion` replaces it with the
still frame.

## Two pre-existing defects fixed on the way

- `scripts/evidence-bundle.mjs` classified a deleted path as
  "line-ending-only" and kept git's quoted path form, so the evidence bundle
  pointed at files that no longer existed. Deletions are now their own kind
  and quoted paths are unquoted.
- `infra/backup/backup.test.mjs` never provided the `POCKET_TTS_VOICE_STATE_PATH`
  durable asset, so the restic backup fixture failed its own inventory check
  before it reached the host. The fixture now writes the asset.

## Deployment

**The VPS checkout `/opt/ei-point` is NOT yet pulled to `f4d5cf6`.** This
machine has no SSH access to the host — the only private key present belongs
to the phone. Per the repository rule, the sync is **pending console access**
and no production model, bot or session has been touched.

When the host is reachable, the sync is a source-only pull to `f4d5cf6`
followed by a rebuild of the `web` service only. The `api`, `migrate`,
model services and bots must not be restarted for this change, and the
migration `020_operator_catalogue.sql` has to be applied before the operator's
catalogue edits are live.
