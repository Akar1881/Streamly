import { isSafeName, readCached } from '@/lib/subtitles/cache';

/**
 * ============================================================================
 *  SUBTITLE FILE SERVER
 * ============================================================================
 *
 *  Serves the translated WebVTT files out of the store:
 *
 *    /api/subtitles/movie-550-en-ckb.vtt
 *
 *  This is the one endpoint that is not for our own front end. The player runs
 *  on someone else's domain and downloads the subtitle from *the viewer's
 *  browser*, so the response has to be readable cross-origin — hence the
 *  wildcard `Access-Control-Allow-Origin`, which is what makes the track load
 *  at all.
 *
 *  When the store is object storage with a public base URL, nothing normally
 *  reaches this route: the player is sent to the store directly, which keeps
 *  the bytes off our bandwidth. It stays because it is the fallback for a
 *  bucket without a public domain, for a URL handed out before the store was
 *  configured, and for every local development run.
 *
 *  Three things are deliberate here:
 *
 *    - The filename is validated by `isSafeName` before it reaches a backend,
 *      so a crafted name cannot read anything outside the store.
 *    - Ranges are honoured. Players probe with `Range` more often than not,
 *      and a server that answers 200 to a range request is a server some of
 *      them give up on.
 *    - The whole request is read-only and cacheable for a day, because a
 *      translated subtitle never changes once it exists.
 * ============================================================================
 */

export const runtime = 'nodejs';

/** Cross-origin, and the headers a media-ish client expects to be able to read. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Origin, Accept',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

/**
 * A single byte range, or null when the header is not one we handle (multi-part
 * ranges are allowed to be ignored, and returning the whole file is a valid
 * answer to them).
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  // `bytes=-500` — the last 500 bytes.
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { unsatisfiable: true };
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { unsatisfiable: true };
  }

  return { start, end: Math.min(end, size - 1) };
}

/** The headers every response shares. */
function baseHeaders(size) {
  return {
    ...CORS,
    'Content-Type': 'text/vtt; charset=utf-8',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
    ...(size === null ? {} : { 'Content-Length': String(size) }),
  };
}

function fail(message, status) {
  return new Response(message, { status, headers: { ...CORS, 'Content-Type': 'text/plain' } });
}

export function OPTIONS() {
  // Preflight, which a cross-origin <track> fetch usually skips — but a player
  // that sends `Range` from a page with different credentials will not.
  return new Response(null, { status: 204, headers: CORS });
}

async function serve(request, { params }, { includeBody }) {
  const { file } = await params;

  // Rejects anything that is not one of our own store names.
  if (!isSafeName(file)) return fail('Not found', 404);

  const contents = await readCached(file);
  if (contents === null) {
    // Not translated yet — or never will be. Either way there is nothing here.
    return fail('Not found', 404);
  }

  const bytes = Buffer.from(contents, 'utf8');
  const rangeHeader = request.headers.get('range');

  if (rangeHeader) {
    const range = parseRange(rangeHeader, bytes.length);

    if (range?.unsatisfiable) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders(null), 'Content-Range': `bytes */${bytes.length}` },
      });
    }

    if (range) {
      const slice = bytes.subarray(range.start, range.end + 1);

      return new Response(includeBody ? slice : null, {
        status: 206,
        headers: {
          ...baseHeaders(slice.length),
          'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`,
        },
      });
    }
    // A range we do not understand falls through to the whole file, which is
    // an explicitly allowed response.
  }

  return new Response(includeBody ? bytes : null, {
    status: 200,
    headers: baseHeaders(bytes.length),
  });
}

export async function GET(request, context) {
  return serve(request, context, { includeBody: true });
}

export async function HEAD(request, context) {
  return serve(request, context, { includeBody: false });
}
