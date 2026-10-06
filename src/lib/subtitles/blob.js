/**
 * ============================================================================
 *  OBJECT STORAGE — Vercel Blob
 * ============================================================================
 *
 *  Where translated subtitles live in production.
 *
 *  The reason this is not simply "the cache directory, but a URL": the viewer's
 *  browser is what downloads the subtitle, and on Vercel the app cannot answer
 *  that from its own disk. The bundle is read-only, and `/tmp` belongs to a
 *  single instance — concurrent requests run in separate containers, each with
 *  its own `/tmp`, and it is emptied when the container is recycled. So the
 *  request that fetches the subtitle is routinely answered by an instance that
 *  never saw the file, and 404s.
 *
 *  Object storage is the piece that is genuinely shared between instances and
 *  outlives the request that wrote it, and it is what gives the subtitle a URL
 *  stable enough to hand to a third-party player.
 *
 *  Blob rather than Cloudflare R2 specifically because it needs no payment
 *  method: it is free on the Hobby plan within its usage limits (1 GB of
 *  storage), and it is part of the platform already being deployed to. R2 is
 *  kept in `r2.js` as the alternative for anyone with a card and more than a
 *  gigabyte of subtitles, since it charges nothing for egress.
 *
 *  No configuration is needed by hand. Creating a Blob store on Vercel and
 *  linking it to the project injects `BLOB_READ_WRITE_TOKEN` into the build,
 *  and that is the only thing this module looks for.
 * ============================================================================
 */

import { BlobNotFoundError, get, head, put } from '@vercel/blob';

/** The token Vercel injects when a Blob store is linked to the project. */
function token() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
}

/** True when object storage is configured and should be used instead of disk. */
export function configured() {
  return token() !== null;
}

/**
 * A store that is unreachable is treated as "nothing cached yet" rather than an
 * error, so the pipeline carries on and the viewer simply plays without
 * subtitles. The same reasoning as in `r2.js`.
 */
function warn(action, error) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[subtitles] Blob ${action} failed: ${error?.message}`);
  }
}

export async function read(name) {
  if (!configured()) return null;

  try {
    const result = await get(name, { access: 'public' });
    if (!result) return null;

    return await new Response(result.stream).text();
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    warn('GET', error);
    return null;
  }
}

export async function exists(name) {
  if (!configured()) return false;

  try {
    return Boolean(await head(name));
  } catch (error) {
    // A missing blob is the ordinary case — it has not been translated yet.
    if (error instanceof BlobNotFoundError) return false;
    warn('HEAD', error);
    return false;
  }
}

/**
 * Stores a finished translation.
 *
 * `addRandomSuffix: false` is load-bearing: it keeps the pathname exactly the
 * cache key, so the URL is predictable and the same file is overwritten rather
 * than a second copy appearing beside it. `allowOverwrite` is needed with it,
 * because Blob refuses to replace an existing blob by default.
 *
 * As on disk, only a *complete* translation is ever passed in — see `jobs.js`.
 */
export async function write(name, contents) {
  await put(name, contents, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'text/vtt; charset=utf-8',
    // A translated subtitle never changes, so let the edge and the browser hold
    // it for as long as they will.
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });
}

/** The public URL the player can fetch this file from, or null if absent. */
export async function url(name) {
  if (!configured()) return null;

  try {
    const blob = await head(name);
    return blob?.url ?? null;
  } catch {
    return null;
  }
}
