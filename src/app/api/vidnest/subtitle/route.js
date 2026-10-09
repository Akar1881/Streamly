/**
 * ============================================================================
 *  VIDNEST SUBTITLE PROXY
 * ============================================================================
 *
 *  One of Vidnest's upstream servers hands back subtitles as a link to *their*
 *  fetch endpoint rather than to the file: a path like `/sub/<base64>`, where
 *  the base64 is `{"u": "...", "h": {"Referer": "..."}}`. Two things follow, and
 *  neither can be solved in the browser.
 *
 *  1. **It is relative.** `/sub/…` resolves against our own origin, so the player
 *     was asking us for a file that was never ours — the captions menu listed
 *     eighty-two languages and every one of them was a 404.
 *
 *  2. **The target wants a `Referer`.** It is on the browser's forbidden-header
 *     list, so a page cannot send it however hard it tries, and the host that
 *     needs it answers with nothing. Their `/sub/` endpoint exists to inject it
 *     server-side, and the payload says exactly which header to inject — so this
 *     route does the same job with the same information, on our side.
 *
 *  There is nothing secret in the payload and nothing to deobfuscate: it is the
 *  file's URL and the headers it wants, in plain base64. The reason it is a
 *  request to us rather than a request to them is that neither of the two facts
 *  above survives the trip through a page.
 * ============================================================================
 */

import { TIMED_OUT, fetchWithDeadline, parseRequestUrl } from '@/lib/proxy/stream';

export const runtime = 'nodejs';

/** Same deadline as every other fetch here; these files run to a few hundred KB. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Which headers the payload is allowed to ask for.
 *
 * An allowlist, and a short one. The value comes out of a query parameter, which
 * means it comes from whoever is using the browser, and a route that forwards
 * arbitrary header names is a way to reach things the caller cannot reach
 * directly. These two are the entire vocabulary this format uses.
 */
const ALLOWED_HEADERS = new Set(['referer', 'origin']);

/** Header values are one line each; a newline would smuggle in another header. */
const SAFE_VALUE = /^[\x20-\x7e]{1,512}$/;

/**
 * The payload, opened.
 *
 * @param {string} value  what followed `/sub/`
 * @returns {{url: string, headers: Record<string, string>}|null}
 */
function readPayload(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed.url !== 'string' && typeof parsed.u !== 'string') return null;

  const headers = {};
  for (const [name, headerValue] of Object.entries(parsed.h ?? {})) {
    const lower = String(name).toLowerCase();
    if (!ALLOWED_HEADERS.has(lower)) continue;
    if (typeof headerValue !== 'string' || !SAFE_VALUE.test(headerValue)) continue;
    headers[lower === 'origin' ? 'Origin' : 'Referer'] = headerValue;
  }

  return { url: parsed.u ?? parsed.url, headers };
}

export async function GET(request) {
  const asked = new URL(request.url).searchParams.get('p');
  const payload = readPayload(asked);
  if (!payload) {
    return new Response('Bad subtitle reference.\n', { status: 400 });
  }

  // The same check every proxy here uses. The URL arrived from the browser, and
  // this route is the machine on the other end of it, so it has to be a public
  // https address before anything is fetched.
  const { url: target, reason } = parseRequestUrl(payload.url);
  if (!target) {
    return new Response(`Refused: ${reason}\n`, { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetchWithDeadline(
      target,
      { headers: payload.headers, cache: 'no-store', signal: request.signal },
      FETCH_TIMEOUT_MS,
    );
  } catch (error) {
    const timedOut = error?.code === TIMED_OUT;
    return new Response(
      timedOut ? 'The subtitle source did not answer in time.\n' : 'The subtitle source failed.\n',
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return new Response('The subtitle source had nothing at that address.\n', {
      status: upstream.status === 404 ? 404 : 502,
    });
  }

  return new Response(upstream.body, {
    headers: {
      // Given as WebVTT whatever the host called it — the bytes are what the
      // element will parse, and a track served as `text/plain` is ignored.
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
