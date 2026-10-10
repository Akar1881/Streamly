/**
 * ============================================================================
 *  VIDROCK STREAM PROXY
 * ============================================================================
 *  The one server this provider reads refuses a browser in two separate ways,
 *  and each of them alone would be enough to need this route.
 *
 *  The playlist is gated on the request: `cdn2.boomchick.org` answers 403 to
 *  anything arriving without a `Referer`, and 200 with one. `Referer` is on the
 *  forbidden-header list, so a page cannot send it — `fetch` drops it without a
 *  word — which is why this works everywhere it is tested by hand and nowhere
 *  it is tested in a browser.
 *
 *  The segments are gated on the response: their host sends
 *  `Access-Control-Allow-Origin: https://vidrock.net`, and no amount of
 *  requesting changes that. A page that cannot see its own origin reflected
 *  back cannot read the bytes, whatever it does to the request.
 *
 *  So this route makes both requests with the headers the hosts want, and
 *  rewrites the playlist so the segments come back through here too.
 *
 *  ---------------------------------------------------------------------------
 *  The content types are a lie and are not passed on
 *  ---------------------------------------------------------------------------
 *
 *  Every segment arrives labelled `image/png`, `image/jpeg` or `audio/ogg`,
 *  cycling through all three down a single playlist, and not one of them is
 *  true: the bytes begin with the MPEG-TS sync byte and go on being a transport
 *  stream. Vidnest's proxy forwards the source's own content type and is right
 *  to, because that host labels its segments correctly. This one cannot, and the
 *  cost of believing it is a specific one: hls.js would shrug and append the
 *  bytes to a Media Source anyway, but Safari plays HLS natively and is not so
 *  forgiving, and Safari is where a mislabelled fragment shows up as a black
 *  screen on a stream that is otherwise fine.
 *
 *  So segments are served as `video/mp2t` — which is what they are — and the
 *  upstream's claim about them is dropped on the floor where it belongs.
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
const ROUTE_PATH = '/api/vidrock/proxy';

/**
 * What vidrock's stream hosts want to see.
 *
 * A constant, not a per-title value, so it lives here rather than on every URL
 * — and on a playlist that is not a small thing, because a film names hundreds
 * of segments and repeating two url-encoded headers on each of them is a lot of
 * bytes spent on something the server already knows. Measured: with either the
 * `Referer` or the `Origin` these hosts answer 200, and with neither they answer
 * 403. Both are sent, since one is not more correct than the other and there is
 * no way to know which a rotating host will ask for next.
 *
 * `Accept` is `*&#47;*` rather than the JSON type the lookup sends, because
 * these are playlists and segments, not API answers.
 */
const UPSTREAM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://vidrock.net/',
  Origin: 'https://vidrock.net',
};

/**
 * How long to wait on the source before giving up.
 *
 * The same deadline, for the same reason, as every other proxy here: a host that
 * accepts the connection and then says nothing would otherwise hold the request
 * until the platform kills it, and the viewer gets a spinner and keeps it.
 */
const UPSTREAM_TIMEOUT_MS = 15_000;

/** What a fragment of this stream is, whatever the host calls it. */
const SEGMENT_CONTENT_TYPE = 'video/mp2t';

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
 * This one is a media playlist rather than a master — a single rendition, no
 * `#EXT-X-STREAM-INF`, no `RESOLUTION` anywhere, which is why the provider
 * declares no quality of its own. `rewritePlaylist` handles both shapes, so
 * nothing here depends on that staying true.
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
      // A playlist is a snapshot of a source that rotates its hosts; a segment
      // never changes.
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * A segment, passed through with the type it should have had.
 *
 * Nothing here is cut off or added, so the source's byte offsets are still ours.
 * That is why the client's `Range` is passed straight on and the status comes
 * back as the source gave it: a proxy that has to rewrite a segment before it
 * can be played could do neither, because every offset in it would move by the
 * size of whatever was removed.
 *
 * The upstream content type is deliberately not among the headers copied below,
 * for the reason in this file's header.
 */
async function segmentResponse(response) {
  const headers = new Headers({
    'Content-Type': SEGMENT_CONTENT_TYPE,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, max-age=3600',
  });

  for (const name of ['accept-ranges', 'content-length', 'content-range']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }

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

    // Keyed on the URL rather than the content type, which for this source is a
    // claim that cannot be believed in either direction: the playlist labels
    // itself honestly and the segments do not, so the one reliable signal is
    // what the address says it is.
    const isPlaylist = /\.m3u8(?:$|\?)/i.test(url.pathname + url.search);

    return isPlaylist ? await playlistResponse(response, url, request) : await segmentResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });
    if (error?.code === TIMED_OUT) {
      return new Response(error.message, { status: 504 });
    }
    console.error('Vidrock stream proxy failed:', error);
    return new Response('The stream could not be fetched.', { status: 502 });
  }
}

export const GET = handle;
export const HEAD = handle;
