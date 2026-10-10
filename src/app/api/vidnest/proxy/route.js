/**
 * ============================================================================
 *  VIDNEST STREAM PROXY
 * ============================================================================
 *  Vidnest is a fan-out over eleven upstream servers, and not one of the hosts
 *  they answer on lets a browser read what it serves.
 *
 *  They refuse it in three different ways, which come to the same thing here.
 *  Most send no `Access-Control-Allow-Origin` at all, so the response is
 *  unreadable whatever the request. A second kind answers 404 to anything
 *  arriving without a `Referer`. The third gates CORS by origin and allows
 *  `vidnest.fun` — and, apparently by oversight, `localhost` — while refusing
 *  the domain this site is served from, which is exactly how this was found:
 *  Neon measured 2160p and played on a development machine, showed no quality
 *  at all on Vercel, and played nothing.
 *
 *  None of that is something a browser can work around. `Referer` and `Origin`
 *  are on the forbidden-header list, so `fetch` drops them silently and sends
 *  the page's own origin instead; and a page that cannot see
 *  `Access-Control-Allow-Origin` cannot read the response even when its request
 *  does arrive. So this route makes the request instead, with the headers the
 *  host wants, and points every URL inside the playlists back at itself so the
 *  segments come the same way.
 *
 *  ---------------------------------------------------------------------------
 *  The headers are the stream's now, not the provider's
 *  ---------------------------------------------------------------------------
 *
 *  While this API was v1 the hosts were one family behind one gate, and the
 *  `Referer` and `Origin` that satisfied them were constants that lived here.
 *  They are not that any more: one title's playlist wants
 *  `pwcloud.animanga.fun`, the next wants `goodstream.cc`, and the servers say
 *  which in their own reply. So the pair arrives on the query string with the
 *  stream it belongs to, the way `src/app/api/videasy/proxy/route.js` takes it,
 *  and the constants below are only the fallback for a stream that named
 *  neither.
 *
 *  Only what the stream actually carried is repeated onto the child URLs. A
 *  playlist names hundreds of segments and a film has thousands, so putting two
 *  url-encoded headers on every one of them to say something the route already
 *  knows is a lot of bytes spent on nothing — and for a stream that named no
 *  headers there is nothing to repeat at all.
 *
 *  ---------------------------------------------------------------------------
 *  A segment is never an image, and a playlist does not always say it is one
 *  ---------------------------------------------------------------------------
 *
 *  Two of the shape problems behind this provider, and both are about metadata
 *  that cannot be believed.
 *
 *  Segments arrive labelled `image/png` on the servers whose CDN ships MPEG-TS
 *  behind a `.png` path. hls.js shrugs and appends the bytes to a Media Source
 *  anyway, but Safari plays HLS natively and is not so forgiving, and Safari is
 *  where a mislabelled fragment is a black screen on a stream that is otherwise
 *  fine. So an `image/*` label is corrected to `video/mp2t`, which is what the
 *  bytes are. Anything else is passed through untouched, because a fragment of
 *  fMP4 labelled `video/mp4` is telling the truth and must be left alone.
 *
 *  A playlist arrives labelled `text/html` on one of them, with `#EXTM3U` as
 *  its first line. So a response is treated as a playlist when its body says it
 *  is one, not when its headers do — the body is the only part of this that is
 *  ever honest, and it is the part we have to read before rewriting anything
 *  either way.
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

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36';

/**
 * What a stream host is sent when the stream named no headers of its own.
 *
 * The pair this route used when it was written, which satisfied both kinds of
 * host behind the v1 API: the `Origin` is what the Cloudflare Workers gate on,
 * and the `Referer` is what the bare hosts demanded. Measured, not guessed.
 * Kept as the fallback because some servers still answer with no headers, and
 * because a stream that wants these and gets nothing is a stream that fails.
 */
const DEFAULT_REFERER = 'https://vidnest.fun/';
const DEFAULT_ORIGIN = 'https://vidnest.fun';

/**
 * How long to wait on the source before giving up.
 *
 * The same deadline, for the same reason, as every other proxy here: a host
 * that accepts the connection and then says nothing would otherwise hold the
 * request until the platform kills it, and the viewer gets a spinner and keeps
 * it.
 */
const UPSTREAM_TIMEOUT_MS = 15_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 4;

/** An absolute https URL, or nothing. Not a URL is the same as not there. */
function httpsUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The headers this stream carried, ready to be sent and to be repeated down.
 *
 * A host that names a `Referer` and no `Origin` is being served from the same
 * site in every case seen here, so the origin is derived from it rather than
 * left to the default — sending the default instead would tell that host the
 * request came from somewhere it plainly did not.
 */
function streamHeaders(params) {
  const referer = httpsUrl(params.get('referer'));
  const named = httpsUrl(params.get('origin'));

  const carried = {};
  if (referer) carried.referer = referer.href;
  if (named) carried.origin = named.origin;
  else if (referer) carried.origin = referer.origin;
  return carried;
}

/** The upstream request's headers: whatever the stream named, or the defaults. */
function upstreamHeaders(carried) {
  return {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: carried.referer ?? DEFAULT_REFERER,
    Origin: carried.origin ?? DEFAULT_ORIGIN,
  };
}

/** A request for a playlist or a segment, following the source's own redirects. */
async function fetchUpstream(target, headers, range, signal) {
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchWithDeadline(
      current,
      {
        headers: range ? { ...headers, Range: range } : headers,
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
 * `rewritePlaylist` catches between them — and the segments beneath them are
 * named by absolute path as often as not, so resolving each child against the
 * playlist it came from lands them in the right place. Only the headers this
 * particular stream carried ride down with them, for the reason in this file's
 * header.
 */
async function playlistResponse(text, url, request, carried) {
  const playlist = rewritePlaylist(text, url, (childUrl) =>
    proxyUrl(ROUTE_PATH, request.url, childUrl, carried),
  );

  return new Response(playlist, {
    status: 200,
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
 * A segment, passed through with a label that can be believed.
 *
 * Nothing here is cut off or added, so the source's byte offsets are still
 * ours. That is why the client's `Range` is passed straight on and the status
 * comes back as the source gave it: a proxy that has to rewrite a segment
 * before it can be played could do neither, because every offset in it would
 * move by the size of whatever was removed.
 */
function segmentResponse(response, contentType) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, max-age=3600',
  });

  for (const name of ['accept-ranges', 'content-length', 'content-range']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }

  // A segment is not a picture — see this file's header.
  if (/^image\//i.test(contentType)) headers.set('Content-Type', 'video/mp2t');
  else if (contentType) headers.set('Content-Type', contentType);

  return new Response(response.body, { status: response.status, headers });
}

async function handle(request) {
  const params = new URL(request.url).searchParams;
  const { url: target, reason } = parseRequestUrl(params.get('url'));
  if (!target) {
    return new Response(`Invalid stream request: ${reason}.`, { status: 400 });
  }

  const carried = streamHeaders(params);
  const headers = upstreamHeaders(carried);

  try {
    const { response, url } = await fetchUpstream(
      target,
      headers,
      request.headers.get('range'),
      request.signal,
    );
    if (!response.ok && response.status !== 206) {
      return new Response('The stream source rejected the request.', { status: response.status });
    }

    const contentType = response.headers.get('content-type') ?? '';

    /**
     * Whether this is a playlist is decided by reading it, not by asking what
     * it is — see this file's header. Only responses that could be one are read
     * as text at all: a manifest is a few kilobytes and arrives as JSON, as
     * `text/html` or as an honest `application/vnd.apple.mpegurl`, while the
     * fragments are megabytes and arrive as video, as `application/octet-stream`
     * or as one of the image labels above. Buffering a segment here to look at
     * its first line would cost the viewer the whole file before it played.
     */
    const readable =
      /mpegurl|text\/|json/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(url.pathname + url.search);

    if (readable) {
      const text = await response.text();
      if (text.trimStart().startsWith('#EXTM3U')) {
        return await playlistResponse(text, url, request, carried);
      }

      // Readable and not a playlist: an error page, most likely. Handed back as
      // it came rather than dressed up as a fragment.
      return new Response(text, {
        status: response.status,
        headers: {
          'Content-Type': contentType || 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    }

    return segmentResponse(response, contentType);
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
