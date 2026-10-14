/**
 * ============================================================================
 *  SUBTITLE CACHE
 * ============================================================================
 *
 *  Translated subtitles are expensive — a title costs a subtitle lookup plus
 *  twenty-odd translate requests, against quotas measured in hundreds a day —
 *  and they never change. So the first viewer of a title pays for it and every
 *  viewer after that gets the stored file back.
 *
 *  Files are named for what they are and what is in them, which makes the store
 *  self-explanatory and means the same URL serves everyone:
 *
 *    movie-550-en-ckb-hls-v2.vtt        Fight Club, English → Sorani
 *    tv-1399-s1e1-en-ckb-hls-v2.vtt     a specific episode
 *
 *  This module owns the keys and the name check; the storing itself is a
 *  backend. There are two, and which one is in use is a deployment question
 *  rather than a code one:
 *
 *    r2.js     Cloudflare R2 — what a deployment runs on. Object storage,
 *              because the *viewer's browser* fetches the file, so it has to
 *              live somewhere shared that outlives the request which wrote it.
 *    disk.js   the filesystem — what a laptop runs on, because it needs no
 *              account and the files are right there to read. This is the
 *              backend the desktop app uses: there is exactly one instance,
 *              and the directory is the shared place.
 *
 *  R2 wins when it is configured, and `disk.js` is the fallback that is always
 *  there.
 *
 *  `publicUrl` is the tell for which one is live: object storage can hand out a
 *  URL directly, a directory cannot, and the API routes use that to decide
 *  whether to send the player to the store or to serve the bytes themselves.
 * ============================================================================
 */

import site from '@config/site';
import * as disk from './disk';
import * as r2 from './r2';

/**
 * The backend for this deployment.
 *
 * Resolved per call rather than once at import: it reads the environment, and
 * caching that decision would make a misconfigured instance stay misconfigured
 * until it was restarted.
 */
function backend() {
  if (r2.configured()) return r2;
  return disk;
}

/**
 * The cache key includes the subtitle-source pipeline version, so translations
 * from the older Wyzie-first lookup are not reused.
 *
 * It encodes everything that would change the file's contents — the title, the
 * language pair — so a file is never served for a translation it does not
 * contain.
 */
export function cacheKey({ mediaType, tmdbId, season, episode }) {
  const isEpisode = mediaType === 'tv' && season && episode;

  return [
    isEpisode ? 'tv' : 'movie',
    tmdbId,
    isEpisode ? `s${season}e${episode}` : null,
    site.subtitles.sourceLanguage,
    site.subtitles.target.code,
    'hls-v2',
  ]
    .filter(Boolean)
    .join('-');
}

/**
 * Only names this module produced are ever opened.
 *
 * The pattern admits digits, letters and hyphens and nothing else, so there is
 * no separator and no `..` for a crafted name to travel on. Every entry point
 * below runs names through it before a backend sees them — including the API
 * route, where the name arrives from the URL and is the one input an attacker
 * controls.
 */
const SAFE_NAME = /^[a-z0-9-]{1,120}\.vtt$/;

export function isSafeName(name) {
  return typeof name === 'string' && SAFE_NAME.test(name);
}

/** The stored file's contents, or null when it has not been translated yet. */
export async function readCached(name) {
  if (!isSafeName(name)) return null;
  return backend().read(name);
}

/** True when a finished translation is already stored. */
export async function isCached(name) {
  if (!isSafeName(name)) return false;
  return backend().exists(name);
}

/**
 * Stores a finished translation.
 *
 * Callers pass only complete files: a half-translated subtitle that is readable
 * is worse than a missing one, because it is served to every later viewer as
 * though it were finished.
 */
export async function writeCached(name, contents) {
  if (!isSafeName(name)) throw new Error(`Refusing to store unsafe subtitle name: ${name}`);
  return backend().write(name, contents);
}

/**
 * A URL the viewer's browser can fetch this file from, or null when the
 * backend cannot serve one and the API route has to do it.
 *
 * Async because asking object storage where a file lives is a request. It is
 * also load-bearing that this is awaited: an unawaited promise is *truthy*, so
 * a caller that forgot would skip the "no URL, serve it ourselves" fallback and
 * put an object where a string belongs — which reaches the player as a subtitle
 * URL of `{}`.
 */
export async function publicUrl(name) {
  if (!isSafeName(name)) return null;
  return backend().url(name);
}

/**
 * True when subtitles are stored somewhere every instance can see.
 *
 * The desktop app is the third case, and it is the one the phrase "every
 * instance" gets wrong. There is exactly one instance, it writes to a directory
 * that stays put across restarts, and it is the same process that later reads
 * the file back — which is everything shared storage is *for*. `disk` is the
 * fallback backend there rather than a compromise, so the warning that treats
 * it as one would be noise on every launch.
 */
export function isShared() {
  if (process.env.STREAMLY_DESKTOP === '1') return true;
  return backend() !== disk;
}
