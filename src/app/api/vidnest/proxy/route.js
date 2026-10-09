/**
 * ============================================================================
 *  VIDNEST STREAM PROXY
 * ============================================================================
 *  Vidnest is a fan-out over ten upstream servers, and not one of the hosts they
 *  answer on lets a browser read what it serves. They refuse it in two different
 *  ways, which come to the same thing here.
 *
 *  Most of them answer on a Cloudflare Worker that fronts the real host and
 *  gates CORS by origin. The gate allows `vidnest.fun`, and — apparently by
 *  oversight — `localhost`, and refuses everything else. So those streams work
 *  on a development machine and fail in production, which is exactly how this
 *  was found: Neon measured 2160p and played locally, showed no quality at all
 *  on Vercel, and played nothing.
 *
 *  Klikxxi answers differently, with a bare hostname on a domain that rotates
 *  every time it is asked — `homechefrecipes.sbs`, `halcyoncreative.site`,
 *  `chillx.sbs` — and that host returns 404 to anything arriving without a
 *  `Referer` of `https://vidnest.fun/`, sending no CORS header at all.
 *
 *  Neither refusal is something a browser can work around. `Referer` and
 *  `Origin` are on the forbidden-header list, so `fetch` drops them silently and
 *  sends the page's own origin instead; and a page that cannot see
 *  `Access-Control-Allow-Origin` cannot read the response even when the request
 *  does arrive. The viewer got a source in the menu, picked it, and watched
 *  nothing.
 *
 *  So this route makes the request instead, with the `Referer` and `Origin` that
 *  satisfy both kinds of host, and points every URL inside the playlists back at
 *  itself so the segments come the same way.
 *
 *  ---------------------------------------------------------------------------
 *  Why this one takes no referer and no origin
 *  ---------------------------------------------------------------------------
 *
 *  Videasy's proxy takes both as query parameters, because its streams are handed
 *  out per-title with an origin that moves. Vidnest's are a constant — the same
 *  two strings for every stream of every title — so they live here. That keeps
 *  them out of the URLs, and on a playlist that is not a detail: a film names
 *  thousands of segments, and repeating two url-encoded headers on every one of
 *  them is a lot of bytes spent on something the server already knows.
 * ============================================================================
 */

import {
  TIMED_OUT,
  fetchWithDeadline,
  parseRequestUrl,
  proxyUrl,
  rewritePlaylist,
} from '@/lib/proxy/stream';

/** The path children are sent back through. Also the route this file serves. */
const ROUTE_PATH = '/api/vidnest/proxy';

/**
 * What Vidnest's stream hosts want to see.
 *
 * These two headers are the whole reason this route exists, and between them
 * they satisfy both kinds of host behind this provider: the `Origin` is what the
 * Cloudflare Workers gate on, and the `Referer` is what klikxxi's bare hosts
 * demand. Measured, not guessed — with them these hosts answer 200, and without
 * them the Workers return no CORS header and the bare hosts return 404.
 *
 * `Accept` is `*&#47;*` rather than the JSON type the lookup sends, because these
 * are playlists and segments, not API answers.
 */
const UPSTREAM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://vidnest.fun/',
  Origin: 'https://vidnest.fun',
};

/**
 * How long to wait on the source before giving up.
 *
 * The same deadline, for the same reason, as every other proxy here: a host that
 * accepts the connection and then says nothing would otherwise hold the request
 * until the platform kills it, and the viewer gets a spinner and keeps it.
 */
const UPSTREAM_TIMEOUT_MS = 15_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 4;

/** A request for a playlist or a segment, following the source's own redirects. */
async function fetchUpstream(target, range, signal) {
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchWithDeadline(
      current,
      {
        headers: range ? { ...UPSTREAM_HEADERS, Range: range } : UPSTREAM_HEADERS,
        redirect: 'manual',
        cache: 'no-store',
        signal,
      },
      UPSTREAM_TIMEOUT_MS,
    );

    if (!REDIRECT_STATUSES.has(response.status)) return { response, url: current };

    const location = response.headers.get('location');
    if (!location || hop === MAX_REDIRECTS) return { response, url: current };

    const next = parseRequestUrl(new URL(location, current).href).url;
    if (!next) throw new Error('The stream redirected somewhere this proxy will not follow.');
    current = next;
  }

  throw new Error('Too many stream redirects.');
}

/**
 * A playlist, with every URL inside it pointed back here.
 *
 * These are masters as often as not — they carry the audio groups, the video
 * rungs and their iframe twins, as `URI="…"` attributes and as bare lines that
 * `rewritePlaylist` catches between them — and the segment URLs beneath them are
 * named by absolute path, so resolving each child against the playlist it came
 * from lands them in the right place. Nothing provider-specific is carried down:
 * the headers this route needs are constants, so the child URLs are as short as
 * they can be.
 */
async function playlistResponse(response, url, request) {
  const playlist = rewritePlaylist(await response.text(), url, (childUrl) =>
    proxyUrl(ROUTE_PATH, request.url, childUrl),
  );

  return new Response(playlist, {
    status: response.status,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      // A playlist is a snapshot of a source that reshuffles its hosts; a
      // segment never changes.
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * A segment, passed through untouched.
 *
 * These need no unpacking: the bytes behind the `.woff2` extension are plain
 * MPEG-TS from the first sync byte, and the host already labels them
 * `video/MP2T` correctly. The extension is a lie for anything glancing at a
 * filename, and it is the only one.
 *
 * Nothing here is cut off or added, so the source's byte offsets are still ours.
 * That is why the client's `Range` is passed straight on and the status comes
 * back as the source gave it: a proxy that has to rewrite a segment before it
 * can be played could do neither, because every offset in it would move by the
 * size of whatever was removed.
 */
async function segmentResponse(response, contentType) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, max-age=3600',
  });

  for (const name of ['accept-ranges', 'content-length', 'content-range']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (contentType) headers.set('Content-Type', contentType);

  return new Response(response.body, { status: response.status, headers });
}

async function handle(request) {
  const params = new URL(request.url).searchParams;
  const { url: target, reason } = parseRequestUrl(params.get('url'));
  if (!target) {
    return new Response(`Invalid stream request: ${reason}.`, { status: 400 });
  }

  try {
    const { response, url } = await fetchUpstream(
      target,
      request.headers.get('range'),
      request.signal,
    );
    if (!response.ok && response.status !== 206) {
      return new Response('The stream source rejected the request.', { status: response.status });
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isPlaylist =
      /mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(url.pathname + url.search);

    return isPlaylist
      ? await playlistResponse(response, url, request)
      : await segmentResponse(response, contentType);
  } catch (error) {
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });
    if (error?.code === TIMED_OUT) {
      return new Response(error.message, { status: 504 });
    }
    console.error('Vidnest stream proxy failed:', error);
    return new Response('The stream could not be fetched.', { status: 502 });
  }
}

export const GET = handle;
export const HEAD = handle;
