/**
 * ============================================================================
 *  VIDPLAY STREAM PROXY
 * ============================================================================
 *  Two reasons a browser cannot play this source by itself, and they point in
 *  opposite directions.
 *
 *  The request is gated. A stream address fetched without a `Referer` and an
 *  `Origin` naming the player page is answered `401 "no token"`, and both are on
 *  the browser's forbidden-header list — a page that sent them would have them
 *  dropped without a word. Worse, the addresses name a source that rotates its
 *  host per title, and the token that authorises them is minted per origin, per
 *  address, at `/generate.php`.
 *
 *  The response is gated too, and this is the one a page cannot argue with at
 *  all. With no `Origin` in the request the CDN answers `Access-Control-Allow-
 *  Origin: *`; with an `Origin` it does not recognise — which is what a browser
 *  on this site sends — Cloudflare answers 403 before the host is reached. So
 *  the bytes are unreachable from the page whichever way it asks, and fetching
 *  them from here, where neither gate applies, is the only way through.
 *
 *  ---------------------------------------------------------------------------
 *  The token is minted here, not at resolve time
 *  ---------------------------------------------------------------------------
 *  A lookup could carry one back — the addresses would then arrive already
 *  authorised — but the token is a JWT claiming the requesting address, so one
 *  minted at resolve time is a bet that the machine answering the resolve is the
 *  machine that will fetch the stream afterwards. That holds on one box and not
 *  reliably behind a fleet, and it goes stale after four hours either way. So it
 *  is minted on the request that needs it, kept per origin for a few minutes
 *  because a film makes thousands of segment requests against one, and thrown
 *  away and asked for again the moment the host rejects the one that was kept.
 *
 *  ---------------------------------------------------------------------------
 *  The content types are a lie, and one of them is dangerous
 *  ---------------------------------------------------------------------------
 *  Playlists label themselves correctly and are passed through as playlists after
 *  being rewritten. Segments do not: every one is served `text/html` under a
 *  `.html` path, and every one is an MPEG-TS fragment — the bytes begin with the
 *  `0x47` sync byte. hls.js would shrug and read the bytes anyway, but Safari
 *  plays HLS natively and is not so forgiving, and `text/html` to it is a black
 *  screen on a stream that is otherwise fine. So segments go out as `video/mp2t`,
 *  which is what they are, and the upstream's claim about them is dropped.
 * ============================================================================
 */

import {
  TIMED_OUT,
  fetchWithDeadline as sharedFetchWithDeadline,
  parseHeaders,
  parseRequestUrl,
  proxyUrl,
  rewritePlaylist as sharedRewritePlaylist,
} from '@/lib/proxy/stream';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** The path children are sent back through. Also the route this file serves. */
const ROUTE_PATH = '/api/vidplay/proxy';

/** What a fragment of this stream is, whatever the host calls it. */
const SEGMENT_CONTENT_TYPE = 'video/mp2t';

/** How long to wait on the source before giving up. */
const UPSTREAM_TIMEOUT_MS = 15_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 4;

/**
 * Host tokens, per origin, for as long as they are worth anything.
 *
 * One mint per origin serves every segment of a film, and the alternative is a
 * round-trip to the source before each of them. Kept short, because a token that
 * has expired turns a request that would have asked for a fresh one into a 403 —
 * which the fetch below already knows how to undo, but better not to need to.
 */
const TOKEN_TTL_MS = 5 * 60_000;
const hostTokens = new Map();

function fetchWithDeadline(url, init) {
  return sharedFetchWithDeadline(url, init, UPSTREAM_TIMEOUT_MS);
}

/** A token from `/generate.php`, whether the host sends it raw or as JSON. */
function parseHostToken(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') return parsed;
      if (parsed && typeof parsed === 'object') {
        return String(parsed.token ?? parsed.data ?? parsed.string ?? parsed.result ?? '');
      }
    } catch {}
  }
  return text;
}

/** Puts a token where this URL wants it — in the path, or in the query. */
function applyToken(url, token, inPath) {
  const next = new URL(url);
  if (inPath) next.pathname = next.pathname.replaceAll('__TOKEN__', token);
  else next.searchParams.set('token', token);
  return next;
}

async function addHostToken(url, headers, signal) {
  const needsPathToken = url.pathname.includes('__TOKEN__');
  const existingToken = url.searchParams.get('token') ?? '';
  if (existingToken && !needsPathToken) {
    return { url, token: existingToken, fromCache: false };
  }

  const cached = hostTokens.get(url.origin);
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) {
    return {
      url: applyToken(url, cached.token, needsPathToken),
      token: cached.token,
      fromCache: true,
    };
  }

  const tokenUrl = new URL('/generate.php', url.origin);
  const response = await fetchWithDeadline(tokenUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      Referer: headers.referer,
      Origin: headers.origin,
    },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) return { url, token: '', fromCache: false };

  const token = parseHostToken(await response.text());
  if (!token || token.includes('429')) return { url, token: existingToken, fromCache: false };

  hostTokens.set(url.origin, { token, at: Date.now() });
  return { url: applyToken(url, token, needsPathToken), token, fromCache: false };
}

/**
 * A child URL with this host's token carried down to it.
 *
 * Only children on the *source's* origin, and only those that do not already
 * carry one — the playlists this host serves come back with the token already
 * written onto every child, so this is the fallback for the day they stop, not
 * the common path. A child that has wandered off to a CDN is left exactly as it
 * is: the token applies to the source and nowhere else.
 */
function withHostToken(childUrl, upstreamUrl, hostToken) {
  if (!hostToken || childUrl.origin !== upstreamUrl.origin) return childUrl;

  const next = new URL(childUrl);
  if (next.pathname.includes('__TOKEN__')) {
    next.pathname = next.pathname.replaceAll('__TOKEN__', hostToken);
  } else if (!next.searchParams.has('token')) {
    next.searchParams.set('token', hostToken);
  }
  return next;
}

function rewritePlaylist(text, upstreamUrl, requestUrl, headers, token) {
  return sharedRewritePlaylist(text, upstreamUrl, (childUrl, from) =>
    proxyUrl(ROUTE_PATH, requestUrl, withHostToken(childUrl, from, token), {
      referer: headers.referer,
      origin: headers.origin,
    }),
  );
}

/** One request for a stream, with the headers its host expects. */
function requestStream(url, headers, range, signal) {
  return fetchWithDeadline(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      Referer: headers.referer,
      Origin: headers.origin,
      ...(range ? { Range: range } : {}),
    },
    redirect: 'manual',
    cache: 'no-store',
    signal,
  });
}

async function fetchUpstream(targetUrl, headers, range, signal) {
  let currentUrl = targetUrl;
  let hostToken = currentUrl.searchParams.get('token') ?? '';

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let authorized = await addHostToken(currentUrl, headers, signal);
    let response = await requestStream(authorized.url, headers, range, signal);

    // A token kept from an earlier segment may have run out since. Carrying one
    // we supplied ourselves and being refused for it is what that looks like,
    // and the cure is to forget it and ask again — once, so a stream that is
    // simply forbidden still fails rather than looping.
    if ((response.status === 401 || response.status === 403) && authorized.fromCache) {
      hostTokens.delete(currentUrl.origin);
      authorized = await addHostToken(currentUrl, headers, signal);
      response = await requestStream(authorized.url, headers, range, signal);
    }

    currentUrl = authorized.url;
    hostToken = authorized.token || hostToken;

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, url: currentUrl, token: hostToken };
    }
    const location = response.headers.get('location');
    if (!location || redirects === MAX_REDIRECTS) {
      return { response, url: currentUrl, token: hostToken };
    }
    const nextUrl = parseRequestUrl(new URL(location, currentUrl).href).url;
    if (!nextUrl) throw new Error('The stream redirected somewhere this proxy will not follow.');
    currentUrl = nextUrl;
    hostToken = currentUrl.searchParams.get('token') ?? '';
  }

  throw new Error('Too many stream redirects.');
}

/** A playlist, with every URL inside it pointed back here. */
function playlistResponse(playlist, status) {
  return new Response(playlist, {
    status,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      // A playlist is a snapshot of a host that rotates; a segment never changes.
      'Cache-Control': 'no-store',
    },
  });
}

/** A segment, passed through with the type it should have had. */
function segmentResponse(response) {
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
  const { url: targetUrl, reason } = parseRequestUrl(params.get('url'));
  if (!targetUrl) {
    return new Response(`Invalid stream request: ${reason}.`, { status: 400 });
  }

  const headers = parseHeaders(params.get('referer'), params.get('origin'));
  if (!headers) {
    return new Response(
      'Invalid stream request: referer and origin must both be absolute https URLs.',
      { status: 400 },
    );
  }

  try {
    const { response, url, token } = await fetchUpstream(
      targetUrl,
      headers,
      request.headers.get('range'),
      request.signal,
    );
    if (!response.ok && response.status !== 206) {
      return new Response('The stream source rejected the request.', { status: response.status });
    }

    // Keyed on the content type and the address together, because the source
    // labels them in opposite directions: a playlist names itself honestly and a
    // segment calls itself `text/html`. Either a playlist content type or an
    // `.m3u8` address settles it.
    const contentType = response.headers.get('content-type') ?? '';
    const isPlaylist =
      /mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(url.pathname + url.search);

    if (isPlaylist) {
      const playlist = rewritePlaylist(await response.text(), url, request.url, headers, token);
      return playlistResponse(playlist, response.status);
    }

    return segmentResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });
    if (error?.code === TIMED_OUT) {
      return new Response(error.message, { status: 504 });
    }
    console.error('Vidplay stream proxy failed:', error);
    return new Response('The stream could not be fetched.', { status: 502 });
  }
}

export const GET = handle;
export const HEAD = handle;
