import {
  TIMED_OUT,
  fetchWithDeadline as sharedFetchWithDeadline,
  parseHeaders,
  parseRequestUrl,
  proxyUrl,
  rewritePlaylist as sharedRewritePlaylist,
} from '@/lib/proxy/stream';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The path children are sent back through. Also the route this file serves. */
const ROUTE_PATH = '/api/videasy/proxy';

/**
 * How long to wait on the source before giving up.
 *
 * Without this a CDN that accepts the connection and then says nothing holds
 * this route open until the platform kills it — the viewer gets a spinner and
 * the invocation is spent. Long enough for a slow segment, short enough to fail
 * while someone is still watching.
 */
const UPSTREAM_TIMEOUT_MS = 15_000;

function fetchWithDeadline(url, init) {
  return sharedFetchWithDeadline(url, init, UPSTREAM_TIMEOUT_MS);
}

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

/**
 * Host tokens, per origin, for as long as they are worth anything.
 *
 * `/generate.php` is a whole extra round-trip to the source, and it was being
 * made on *every* request that arrived without `token` already on it. That is
 * cheap for a playlist and expensive for a film, because a playlist that does
 * not carry the token on to its segments means one of these before every
 * fragment — the same question asked a thousand times, and answered the same.
 *
 * So the answer is kept. It is per host and per short while, because a token
 * that has expired is worse than none: it turns a request that would have asked
 * for a fresh one into a 403.
 */
const TOKEN_TTL_MS = 5 * 60_000;
const hostTokens = new Map();

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
  if (!token) return { url, token: existingToken, fromCache: false };

  hostTokens.set(url.origin, { token, at: Date.now() });
  return { url: applyToken(url, token, needsPathToken), token, fromCache: false };
}

/**
 * A child URL with this host's token carried down to it.
 *
 * Videasy's own contribution to `rewritePlaylist`, and the reason that function
 * takes a hook at all: the token applies to URLs on the *source's* origin and
 * nowhere else, so a child that has wandered off to a CDN is left exactly as it
 * is. Whether it belongs in the path or the query is the URL's own business —
 * `__TOKEN__` marks the spot when it is the former.
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
  for (let redirects = 0; redirects <= 4; redirects += 1) {
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
    if (!location || redirects === 4) {
      return { response, url: currentUrl, token: hostToken };
    }
    const nextUrl = parseRequestUrl(new URL(location, currentUrl).href).url;
    if (!nextUrl) throw new Error('The stream redirected somewhere this proxy will not follow.');
    currentUrl = nextUrl;
    hostToken = currentUrl.searchParams.get('token') ?? '';
  }
  throw new Error('Too many stream redirects.');
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

  // The viewer closing the tab and the source going quiet are different things
  // and end differently below: the first is relayed straight through, the second
  // gets a deadline inside `fetchWithDeadline`.
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

    const contentType = response.headers.get('content-type') ?? '';
    const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(url.pathname + url.search);
    const responseHeaders = new Headers({
      'Access-Control-Allow-Origin': '*',
      // A playlist is a snapshot and goes stale in seconds. A segment never
      // changes — it is one numbered piece of one film — and it is large, so
      // the browser keeping a copy is the difference between seeking back
      // through a scene being instant and being a second trip through this
      // route to the source. `private` because it is the viewer's own cache,
      // not a shared one's.
      'Cache-Control': isPlaylist ? 'no-store' : 'private, max-age=3600',
    });
    for (const name of ['accept-ranges', 'content-length', 'content-range']) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    if (isPlaylist) {
      const playlist = rewritePlaylist(await response.text(), url, request.url, headers, token);
      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
      return new Response(playlist, { status: response.status, headers: responseHeaders });
    }

    if (contentType) responseHeaders.set('Content-Type', contentType);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (error) {
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });
    if (error?.code === TIMED_OUT) {
      return new Response(error.message, { status: 504 });
    }
    console.error('Videasy stream proxy failed:', error);
    return new Response('The stream could not be fetched.', { status: 502 });
  }
}

export const GET = handle;
export const HEAD = handle;