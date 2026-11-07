// Media manifest for the World layer (redesign infrastructure §5).
//
// One place that answers "where does the film, the soundtrack and the posters
// actually live". Nothing in the component hardcodes a `/media/...` path any
// more, so the same build can serve bundles from the web image or from a public
// Cloud Storage bucket without editing a component.
//
// Resolution order, first value wins:
//   1. NEXT_PUBLIC_MEDIA_BASE_URL  — absolute base, e.g.
//      https://storage.googleapis.com/ei-point-public-media/media
//   2. MEDIA_BASE_PATH             — server-side base rendered into the bundle
//   3. ""                          — legacy same-origin /media/... under public/
//
// A base may be written with or without a trailing slash. Empty base keeps the
// current relative paths, so this file is behaviour-preserving until an operator
// sets one of the two variables.
//
// IMPORTANT: only names that exist in apps/dashboard/public/media are listed.
// A URL that 404s must degrade to a poster, never to a broken player.

const RAW_BASE =
  process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.trim() ||
  process.env.MEDIA_BASE_PATH?.trim() ||
  "";

/** Normalised base with no trailing slash ("" stays ""). */
export const MEDIA_BASE = RAW_BASE.replace(/\/+$/u, "");

/** Join a repo-relative media path onto the configured base. */
export function mediaUrl(path: string): string {
  const relative = path.replace(/^\/+/u, "");
  return MEDIA_BASE ? `${MEDIA_BASE}/${relative}` : `/${relative}`;
}

/**
 * The three moving parts of the World layer. Names are stable and include
 * enough of the resolution in them that a re-encode is a new URL (which is what
 * lets immutable caching be honest).
 */
export const FILM_1080 = mediaUrl("media/film-1080.mp4");
export const FILM_540 = mediaUrl("media/film-540.mp4");
export const SOUNDTRACK = mediaUrl("media/loop.mp3");

/** Character scenes cut from the single film, with their seek points. */
export const SCENE_POSTERS = {
  ambient: mediaUrl("media/posters/ambient.jpg"),
  city: mediaUrl("media/posters/ch1-city.jpg"),
  street: mediaUrl("media/posters/ch2-street.jpg"),
  starfield: mediaUrl("media/posters/ch3-starfield.jpg"),
  stage: mediaUrl("media/posters/ch4-stage.jpg"),
  deep: mediaUrl("media/posters/ch5-deep.jpg"),
  wanderers: mediaUrl("media/posters/ch6-wanderers.jpg"),
  throne: mediaUrl("media/posters/ch7-throne.jpg"),
  orb: mediaUrl("media/posters/ch8-orb.jpg"),
} as const;

export type ScenePosterName = keyof typeof SCENE_POSTERS;

/** Same-origin default poster used before any scene is chosen (CSS layer). */
export const DEFAULT_POSTER = mediaUrl("media/posters/ambient.jpg");

/**
 * True when the bundle is told to reach an absolute media host. The World layer
 * only needs to know this to decide whether a same-origin preload hint is
 * meaningful (it is not, cross-origin, without a matching preconnect).
 */
export const MEDIA_IS_REMOTE = /^https?:\/\//u.test(MEDIA_BASE);