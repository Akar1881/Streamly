/**
 * ============================================================================
 *  OBJECT STORAGE — Cloudflare R2
 * ============================================================================
 *
 *  Where translated subtitles live in production.
 *
 *  The reason this is not simply "the cache directory, but a URL": the viewer's
 *  browser is what downloads the subtitle, and on a serverless host the app
 *  cannot answer that from its own disk. The bundle is read-only and `/tmp`
 *  belongs to one instance, so a file written while serving a request is not
 *  there when the next one lands somewhere else. Object storage is the piece
 *  that is genuinely shared, and it is also what gives the subtitle a URL
 *  stable enough to hand to a third-party player.
 *
 *  R2 in particular because the subtitle is fetched again by *every* viewer of
 *  a title, and R2 charges nothing for egress. Its free tier — 10 GB, 10M reads
 *  a month, unlimited transfer — holds thousands of titles.
 *
 *  `aws4fetch` rather than the AWS SDK: it signs an S3 request in a few
 *  kilobytes, which is the difference between a cold start and a slow one.
 *  The SDK would be megabytes for the four verbs used here.
 *
 *  The bucket must be publicly readable, and its CORS policy must allow `GET`
 *  from any origin — the player fetches this cross-origin, and a missing CORS
 *  rule is a subtitle that silently never appears.
 * ============================================================================
 */

import { AwsClient } from 'aws4fetch';

/**
 * The R2 settings, or null when the store is not configured — in which case
 * `cache.js` falls back to the filesystem and everything still works locally.
 */
function config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    /**
     * Where the bucket is served publicly — an `r2.dev` subdomain or a custom
     * domain. Optional: without it files are still stored and read fine, they
     * just have to be proxied through `/api/subtitles/…` instead of being
     * handed to the player directly.
     */
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL?.trim()?.replace(/\/+$/, '') || null,
  };
}

/** True when object storage is configured and should be used instead of disk. */
export function configured() {
  return config() !== null;
}

let signer = null;

/** The S3 client, built once. */
function client() {
  if (!signer) {
    const { accessKeyId, secretAccessKey } = config();
    signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  }

  return signer;
}

/**
 * R2's S3 endpoint for one object.
 *
 * `region: 'auto'` above and this hostname are both required — R2 is
 * S3-compatible, not S3, and signing against a region it does not have is a
 * 403 with no useful message.
 */
function objectUrl(name) {
  const { accountId, bucket } = config();
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeURIComponent(name)}`;
}

/**
 * One signed request.
 *
 * Returns null rather than throwing when the store is unreachable, so callers
 * can treat "R2 is down" the same as "not cached yet" — the pipeline carries on
 * and the viewer simply plays without subtitles.
 */
async function send(name, method, body) {
  if (!config()) return null;

  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'text/vtt; charset=utf-8';
    // A translated subtitle never changes, so let R2's edge keep it.
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  try {
    return await client().fetch(objectUrl(name), { method, body, headers });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[subtitles] R2 ${method} failed: ${error?.message}`);
    }
    return null;
  }
}

export async function read(name) {
  const response = await send(name, 'GET');
  if (!response?.ok) return null;

  return response.text();
}

export async function exists(name) {
  const response = await send(name, 'HEAD');
  return Boolean(response?.ok);
}

/**
 * Stores a finished translation.
 *
 * There is no temp-then-rename here as there is on disk: an object store
 * replaces the whole object in one operation, so a reader never sees a partial
 * file. Only a *complete* translation is ever passed in — see `jobs.js`.
 */
export async function write(name, contents) {
  const response = await send(name, 'PUT', contents);

  if (!response?.ok) {
    throw new Error(`Could not store the subtitle (R2 returned ${response?.status ?? 'nothing'})`);
  }
}

/** The public URL for a stored file, or null when the bucket has no public base. */
export function url(name) {
  const { publicBaseUrl } = config() ?? {};
  if (!publicBaseUrl) return null;

  return `${publicBaseUrl}/${encodeURIComponent(name)}`;
}
