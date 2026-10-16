/**
 * ============================================================================
 *  OBJECT STORAGE — Netlify Blobs
 * ============================================================================
 *
 *  Where translated subtitles live in production.
 *
 *  The reason this is not simply "the cache directory, but a URL": the viewer's
 *  browser is what downloads the subtitle, and on a serverless host the app
 *  cannot answer that from its own disk. The bundle is read-only, and `/tmp`
 *  belongs to a single instance — concurrent requests run in separate
 *  containers, each with its own `/tmp`, and it is emptied when the container
 *  is recycled. So the request that fetches the subtitle is routinely answered
 *  by an instance that never saw the file, and 404s.
 *
 *  Object storage is the piece that is genuinely shared between instances and
 *  outlives the request that wrote it.
 *
 *  Netlify Blobs rather than Cloudflare R2 specifically because it needs no
 *  account, key or payment method: it is part of the platform already being
 *  deployed to, and a site-wide store persists across deploys. R2 is kept in
 *  `r2.js` as the alternative for anyone who would rather keep the bytes off
 *  the app entirely, since it can hand the player a public URL.
 *
 *  No configuration is needed by hand. On Netlify the functions runtime
 *  provides the Blobs context automatically, and `netlify dev` emulates it
 *  locally. Anywhere else `getStore` throws, and the cache falls back to the
 *  next backend.
 * ============================================================================
 */

import { getStore } from '@netlify/blobs';

/** The site-wide store translated subtitles are kept in. */
const STORE_NAME = 'subtitles';

/** The store, or null when this process is not running with a Blobs context. */
function store() {
  try {
    return getStore(STORE_NAME);
  } catch {
    return null;
  }
}

/** True when object storage is available and should be used instead of disk. */
export function configured() {
  return store() !== null;
}

/**
 * A store that is unreachable is treated as "nothing cached yet" rather than an
 * error, so the pipeline carries on and the viewer simply plays without
 * subtitles. The same reasoning as in `r2.js`.
 */
function warn(action, error) {
  console.warn(`[subtitles] Netlify Blobs ${action} failed: ${error?.message}`);
}

export async function read(name) {
  const blobs = store();
  if (!blobs) return null;

  try {
    return await blobs.get(name, { type: 'text' });
  } catch (error) {
    warn('GET', error);
    return null;
  }
}

export async function exists(name) {
  const blobs = store();
  if (!blobs) return false;

  try {
    // A missing blob is the ordinary case — it has not been translated yet.
    return (await blobs.getMetadata(name)) !== null;
  } catch (error) {
    warn('HEAD', error);
    return false;
  }
}

/**
 * Stores a finished translation, keyed by the cache name so the same file is
 * overwritten rather than a second copy appearing beside it.
 *
 * As on disk, only a *complete* translation is ever passed in — see `jobs.js`.
 */
export async function write(name, contents) {
  const blobs = store();
  if (!blobs) throw new Error('Netlify Blobs is not available in this environment');

  await blobs.set(name, contents);
}

/**
 * Netlify Blobs has no public URL, so the player is always sent to
 * `/api/subtitles/<name>`, which reads the file out of the store and serves it
 * with the CORS headers the player needs.
 */
export async function url() {
  return null;
}
