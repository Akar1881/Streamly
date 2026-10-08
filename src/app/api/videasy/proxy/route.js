const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * How long to wait on the source before giving up.
 *
 * Without this a CDN that accepts the connection and then says nothing holds
 * this route open until the platform kills it — the viewer gets a spinner and
 * the invocation is spent. Long enough for a slow segment, short enough to fail
 * while someone is still watching.
 */
const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * What this proxy will not fetch.
 *
 * The permitted hosts used to be written out by hand, three rotating domains at
 * a time, and it could not be kept up: the stream URLs come from the player's
 * own config, they move to a new domain whenever the source feels like it, and
 * the moment one did, every request for a title was refused with a 400 that said
 * nothing about why.
 *
 * So the rule is inverted — any host, except the ones a request must never be
 * able to reach. What that protects is the machine this runs on: `localhost`,
 * the private ranges, and above all the cloud metadata address, which is the
 * real prize in a request-forging bug and hands out instance credentials at
 * 169.254.169.254 on AWS and GCP alike.
 *
 * It does *not* stop this endpoint being used to fetch public URLs on our
 * behalf, from our server's IP. That is the deliberate trade for not breaking
 * every time the source moves, and it is worth re-deciding before this is a
 * public site. Nor does it defend against a public name that resolves to a
 * private address — that would need a lookup and a check of the result, which
 * is a different piece of work.
 */
const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

/** Whether a hostname is somewhere out on the public internet. */
function isPublicHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();

  // Literal addresses are refused outright — all of them, not just the private
  // ones. A CDN is reached by name, so a bare address in a stream URL is a probe
  // or a fault, and refusing the whole shape closes the spellings along with it:
  // the URL parser turns `2130706433`, `0x7f.1` and `127.1` into `127.0.0.1` by
  // itself, and an IPv4-mapped loopback arrives as `[::ffff:7f00:1]`, which no
  // list of ranges written by hand anticipates.
  if (host.includes(':') || /^\d+(\.\d+){1,3}$/.test(host)) return false;

  // A bare name with no dot in it resolves on whatever network this machine is
  // joined to, so it is never a public host — `localhost` included.
  if (!host.includes('.')) return false;

  return !BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * The requested stream, or why it will not be fetched.
 *
 * Returns a reason rather than a bare `null` because the ways this fails need
 * different fixes. A malformed URL is our own bug; a refused host is either
 * something internal being probed or a mistake worth seeing in the browser.
 */
function parseRequestUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { reason: 'the stream URL is not a valid URL' };
  }

  if (url.protocol !== 'https:') return { reason: 'the stream URL is not https' };
  if (url.username || url.password) {
    return { reason: 'the stream URL carries credentials' };
  }
  if (url.port && url.port !== '443') {
    return { reason: `the stream URL uses port ${url.port}` };
  }
  if (!isPublicHost(url.hostname)) {
    return { reason: `"${url.hostname}" is not a public host` };
  }

  return { url };
}

/**
 * The headers the stream host expects, or null when they are missing.
 *
 * Both have to be https URLs, and nothing more than that. This used to demand
 * that they shared an origin, on the reasoning that a real player page and a
 * real API answer from the same site — but they need not, and when the source
 * serves its player from one domain and its streams from another, every single
 * request was rejected before it left. Neither value constrains what this route
 * can reach: the destination is settled by `parseRequestUrl`, and these are only
 * sent along as headers.
 */
function parseHeaders(refererValue, originValue) {
  try {
    const referer = new URL(refererValue);
    const origin = new URL(originValue);
    if (referer.protocol !== 'https:' || origin.protocol !== 'https:') return null;
    return { referer: referer.href, origin: origin.origin };
  } catch {
    return null;
  }
}

/**
 * A request with a deadline on the *answer*, not on the download.
 *
 * `AbortSignal.timeout` would be one line, and it is wrong here: it stays armed
 * for the whole life of the call, body included, and the body is the part that
 * takes the time. A 40-second fragment on a slow line would be cut off halfway
 * through and handed to the player truncated — which hls.js sees as a decode
 * failure, not as a timeout. What needs a limit is the wait for the source to
 * say anything at all. Once it has, the download is the viewer's to make at
 * whatever speed their connection manages.
 *
 * The viewer's own signal is relayed rather than passed through, so a closed tab
 * still cancels a body in flight.
 */
const TIMED_OUT = 'upstream-timeout';

async function fetchWithDeadline(url, init) {
  const controller = new AbortController();
  const relay = () => controller.abort();
  init.signal?.addEventListener('abort', relay, { once: true });

  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (expired) {
      throw Object.assign(new Error('The stream source did not answer in time.'), {
        code: TIMED_OUT,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function proxyUrl(requestUrl, targetUrl, headers) {
  const proxy = new URL('/api/videasy/proxy', requestUrl);
  proxy.searchParams.set('url', targetUrl.href);
  proxy.searchParams.set('referer', headers.referer);
  proxy.searchParams.set('origin', headers.origin);
  return proxy.href;
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

function rewritePlaylist(text, upstreamUrl, requestUrl, headers, hostToken) {
  const rewrite = (value) => {
    if (/^(data:|skd:)/i.test(value)) return value;
    try {
      const childUrl = new URL(value, upstreamUrl);
      if (childUrl.origin === upstreamUrl.origin && hostToken) {
        if (childUrl.pathname.includes('__TOKEN__')) {
          childUrl.pathname = childUrl.pathname.replaceAll('__TOKEN__', hostToken);
        } else if (!childUrl.searchParams.has('token')) {
          childUrl.searchParams.set('token', hostToken);
        }
      }
      return proxyUrl(requestUrl, childUrl, headers);
    } catch {
      return value;
    }
  };

  return text
    .replace(/URI="([^"]+)"/g, (_match, value) => `URI="${rewrite(value)}"`)
    .split(/(\r?\n)/)
    .map((line) => {
      if (!line || line.startsWith('#')) return line;
      const trimmed = line.trim();
      return trimmed ? rewrite(trimmed) : line;
    })
    .join('');
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