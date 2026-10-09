/**
 * ============================================================================
 *  STREAM PROXY — the parts every provider's proxy needs
 * ============================================================================
 *  Several sources hand back stream URLs that a browser cannot fetch for
 *  itself: they want a `Referer`, an `Origin` or a `User-Agent`, all of which
 *  are on the forbidden-header list and are dropped by `fetch` without a word.
 *  Reaching those means asking our own server to fetch them instead, which is
 *  what the routes under `src/app/api/<provider>/proxy/` do.
 *
 *  This is the part of that which is the same whoever is asking. It is here
 *  rather than copied into each route for one reason above the others: the host
 *  check below is the thing standing between a request-forging bug and the
 *  machine this runs on, and two copies of a security check drift. The first
 *  time one copy is fixed and the other is not, the fix is worth nothing.
 *
 *  What is *not* here is anything provider-specific — which headers to send,
 *  how a URL is decorated before it is fetched, whether the response needs
 *  unpacking. Those stay in the route that knows about them.
 * ============================================================================
 */

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
 * every time a source moves, and it is worth re-deciding before this is a
 * public site. Nor does it defend against a public name that resolves to a
 * private address — that would need a lookup and a check of the result, which
 * is a different piece of work.
 */
const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

/** Whether a hostname is somewhere out on the public internet. */
export function isPublicHost(hostname) {
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
export function parseRequestUrl(value) {
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
export function parseHeaders(refererValue, originValue) {
  try {
    const referer = new URL(refererValue);
    const origin = new URL(originValue);
    if (referer.protocol !== 'https:' || origin.protocol !== 'https:') return null;
    return { referer: referer.href, origin: origin.origin };
  } catch {
    return null;
  }
}

/** The marker a deadline puts on an error, so a caller can say which it was. */
export const TIMED_OUT = 'upstream-timeout';

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
export async function fetchWithDeadline(url, init, timeoutMs) {
  const controller = new AbortController();
  const relay = () => controller.abort();
  init.signal?.addEventListener('abort', relay, { once: true });

  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

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

/**
 * The URL a child of `targetUrl` should be reached at, via us.
 *
 * `params` is whatever else the route needs to be told to fetch this child —
 * Videasy passes the `referer` and `origin` its stream hosts demand. A provider
 * whose headers are constants passes nothing and keeps its URLs short, which is
 * not a detail on a playlist: those URLs are repeated for every segment, and a
 * film has thousands.
 */
export function proxyUrl(routePath, requestUrl, targetUrl, params = {}) {
  const proxy = new URL(routePath, requestUrl);
  proxy.searchParams.set('url', targetUrl.href);
  for (const [name, value] of Object.entries(params)) {
    proxy.searchParams.set(name, value);
  }
  return proxy.href;
}

/**
 * A playlist with every child URL pointed back at us.
 *
 * Both kinds of line a playlist can carry a URL on — `URI="…"` attributes and
 * the bare segment lines between tags — because a playlist that sends us to
 * itself for the variants and straight to the source for the segments is worse
 * than not proxying at all: the segments are the part that needs the headers.
 *
 * `toProxyUrl(childUrl, upstreamUrl)` turns a child into the URL it should be
 * reached at, and is the only thing a provider has to supply. It is a callback
 * rather than a set of options because what a provider needs on the URL is its
 * own business: Videasy carries a host token down from a master playlist to the
 * segments beneath it.
 *
 * `data:` and `skd:` are left alone — they are already the content, not a
 * location.
 */
export function rewritePlaylist(text, upstreamUrl, toProxyUrl) {
  const rewrite = (value) => {
    if (/^(data:|skd:)/i.test(value)) return value;
    try {
      return toProxyUrl(new URL(value, upstreamUrl), upstreamUrl);
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
