/**
 * ============================================================================
 *  MAIN STREAM PROXY
 * ============================================================================
 *  The stream hosts behind this provider do let a browser read them — they send
 *  `Access-Control-Allow-Origin: *` on the master playlist, on the variants and
 *  on the segments, and they answer 200 to a request carrying no `Referer` at
 *  all. So this route is not here for CORS, and it is not here to add headers.
 *
 *  It is here because of the query string.
 *
 *  The stream address arrives already signed, and the signature is minted per
 *  requesting address: the URL carries `asn=`, `s=` and `e=` parameters, and the
 *  `asn` is the caller's — measured, not guessed, by resolving a title and
 *  finding this machine's own ASN in the result. A URL minted by the server and
 *  then played by a browser somewhere else would be presented from an address it
 *  was not minted for. Fetching it here, from the machine that resolved it, is
 *  what keeps the two the same.
 *
 *  That is the whole of the difference between this route and
 *  `src/app/api/vidnest/proxy/route.js`, which is otherwise its model. There is
 *  no per-stream `referer`/`origin` to carry, so children come back with clean
 *  URLs — which on a playlist repeated for every segment of a film is the
 *  difference between a short URL and a long one a few thousand times over.
 *
 *  ---------------------------------------------------------------------------
 *  A segment is never an image, and a playlist does not always say it is one
 *  ---------------------------------------------------------------------------
 *
 *  Two shape problems, and both are about metadata that cannot be believed.
 *
 *  Segments arrive labelled `image/png` on the CDNs that ship MPEG-TS behind a
 *  `.png` path. hls.js shrugs and appends the bytes to a Media Source anyway,
 *  but Safari plays HLS natively and is not so forgiving, and Safari is where a
 *  mislabelled fragment is a black screen on a stream that is otherwise fine. So
 *  an `image/*` label is corrected to `video/mp2t`, which is what the bytes are.
 *  Anything else is passed through untouched, because a fragment of fMP4
 *  labelled `video/mp4` is telling the truth and must be left alone.
 *
 *  A playlist can arrive labelled `text/html` with `#EXTM3U` as its first line.
 *  So a response is treated as a playlist when its body says it is one, not when
 *  its headers do — the body is the only part of this that is ever honest, and
 *  it is the part we have to read before rewriting anything either way.
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
const ROUTE_PATH = '/api/himovies/proxy';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36';

/** What the host is sent. Nothing here is gated on a `Referer` — see the header. */
const UPSTREAM_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * How long to wait on the source before giving up.
 *
 * The same deadline, for the same reason, as every other proxy here: a host
 * that accepts the connection and then says nothing would otherwise hold the
 * request until the platform kills it, and the viewer gets a spinner and keeps
 * it. It is a deadline on the *answer*, not on the download — see
 * `fetchWithDeadline`, which stops counting once the source has replied, so a
 * long segment on a slow line is not cut off halfway.
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
 * `rewritePlaylist` catches between them — and the segments beneath them are
 * named by absolute path as often as not, so resolving each child against the
 * playlist it came from lands them in the right place. The signature rides on
 * the child URLs themselves, so there is nothing else to carry down.
 */
async function playlistResponse(text, url, request) {
  const playlist = rewritePlaylist(text, url, (childUrl) =>
    proxyUrl(ROUTE_PATH, request.url, childUrl),
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
        return await playlistResponse(text, url, request);
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
    console.error('Main stream proxy failed:', error);
    return new Response('The stream could not be fetched.', { status: 502 });
  }
}

export const GET = handle;
export const HEAD = handle;
