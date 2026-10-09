/**
 * ============================================================================
 *  VIDROCK STREAM PROXY
 * ============================================================================
 *  VidRock's segments cannot be played from the browser as they arrive, for two
 *  separate reasons, and this route exists for both of them.
 *
 *  1. They want a `Referer` and an `Origin` of `vidrock.net`. Both are on the
 *     browser's forbidden-header list, so `fetch` drops them without a word and
 *     the host answers 404 — the viewer sees "the source rejected the request"
 *     and there is nothing on the client side that can fix it.
 *
 *  2. One of the two hosts that answer serves its segments with a seventy-byte
 *     PNG stapled to the front — a 1×1 image whose only purpose is to make the
 *     bytes look like a picture to anything glancing at them. Behind it, at
 *     exactly the byte after the `IEND` chunk, the video starts. Both hosts then
 *     label everything `image/png`, which is the same lie in a different place.
 *
 *  So this is not a proxy that only rewrites playlists. It inspects the first
 *  few hundred bytes of whatever comes back, discards the picture if there is
 *  one, and tells the truth about the type it settles on.
 *
 *  ---------------------------------------------------------------------------
 *  Why this one does not take a referer and an origin
 *  ---------------------------------------------------------------------------
 *
 *  Videasy's proxy takes both as query parameters, because its streams are
 *  handed out per-title with an origin that moves. VidRock's are constants — the
 *  same two strings on every request for every title — so they live here. That
 *  keeps them out of the URLs, which matters: a playlist names every segment,
 *  and repeating two url-encoded headers a few thousand times over is a lot of
 *  bytes to spend on something the server already knows.
 * ============================================================================
 */

import {
  TIMED_OUT,
  fetchWithDeadline,
  parseRequestUrl,
  proxyUrl,
  rewritePlaylist,
} from '@/lib/proxy/stream';
import { isTransportStream, wrapperLength } from '@/lib/media/transport-stream';

/** The path children are sent back through. Also the route this file serves. */
const ROUTE_PATH = '/api/vidrock/proxy';

/**
 * What VidRock's stream hosts want to see.
 *
 * `Accept` is `*&#47;*` rather than the JSON type the lookup sends — these are
 * segments, not API answers — but the referer and origin are the same two values
 * the lookup uses, because the whole point is that this looks like a request
 * from their own player.
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

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 4;

/** How much of a body to look at before deciding what it is. */
const SNIFF_BYTES = 512;

/** The first few hundred bytes of a body, and the reader holding the rest. */
async function primeBody(stream, size) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;

  while (length < size) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.length) {
      chunks.push(value);
      length += value.length;
    }
  }

  return { reader, head: Buffer.concat(chunks) };
}

/**
 * The rest of the body, with `offset` bytes taken off the front.
 *
 * The head has already been read to decide what this is, so it is handed over
 * here rather than read twice — and the remainder is piped through untouched
 * instead of being collected first, because a segment runs to tens of megabytes
 * and buffering one per viewer is a memory bill with nothing to show for it.
 */
function bodyFrom(reader, head, offset) {
  const start = Math.min(offset, head.length);
  let primed = false;

  return new ReadableStream({
    async pull(controller) {
      if (!primed) {
        primed = true;
        const rest = new Uint8Array(head.buffer, head.byteOffset + start, head.length - start);
        if (rest.byteLength > 0) controller.enqueue(rest);
        return;
      }

      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** A request for a segment or playlist, following the source's own redirects. */
async function fetchUpstream(target, signal) {
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchWithDeadline(
      current,
      {
        headers: UPSTREAM_HEADERS,
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
 * A playlist, with every segment under it pointed back here.
 *
 * Both hosts hand out plain media playlists with no `RESOLUTION` on them, so
 * there is no variant list to choose between and nothing to say about quality —
 * what matters is that the segment URLs underneath are rewritten, because those
 * are the requests that need the referer.
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
 * A segment, unwrapped if it came wrapped and labelled as what it is.
 *
 * The client's own `Range` is deliberately not passed on. Once the picture is
 * cut off the front, the source's byte offsets and ours differ by those seventy
 * bytes for the whole segment, so a range asked for in our numbering would be
 * answered in theirs and hand the player a slice of the wrong place — silently,
 * with no error to explain the gap. The playlists carry no `#EXT-X-BYTERANGE`,
 * so a player asks for whole segments anyway; where one does ask for a range it
 * gets the whole thing, which is a wasted transfer and not a wrong picture.
 */
async function segmentResponse(response, request, contentType) {
  const { reader, head } = await primeBody(response.body, SNIFF_BYTES);
  const wrapper = wrapperLength(head);
  const body = bodyFrom(reader, head, wrapper);

  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, max-age=3600',
    // The truth, because upstream's is wrong and this route does not honour
    // ranges in the client's numbering. See above.
    'Accept-Ranges': 'none',
  });

  const opening = head.subarray(wrapper);
  if (isTransportStream(opening)) headers.set('Content-Type', 'video/mp2t');
  else if (contentType) headers.set('Content-Type', contentType);

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > wrapper) {
    headers.set('Content-Length', String(declared - wrapper));
  }

  return new Response(body, { status: 200, headers });
}

async function handle(request) {
  const params = new URL(request.url).searchParams;
  const { url: target, reason } = parseRequestUrl(params.get('url'));
  if (!target) {
    return new Response(`Invalid stream request: ${reason}.`, { status: 400 });
  }

  try {
    const { response, url } = await fetchUpstream(target, request.signal);
    if (!response.ok && response.status !== 206) {
      return new Response('The stream source rejected the request.', { status: response.status });
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isPlaylist =
      /mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(url.pathname + url.search);

    return isPlaylist
      ? await playlistResponse(response, url, request)
      : await segmentResponse(response, request, contentType);
  } catch (error) {
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });
    if (error?.code === TIMED_OUT) {
      return new Response(error.message, { status: 504 });
    }
    console.error('VidRock stream proxy failed:', error);
    return new Response('The stream could not be fetched.', { status: 502 });
  }
}

export const GET = handle;
export const HEAD = handle;
