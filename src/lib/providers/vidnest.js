/**
 * ============================================================================
 *  VIDNEST — the lookup
 * ============================================================================
 *  One title in, a list of streams out. Vidnest is not a host but a fan-out:
 *  eleven upstream servers are asked in parallel and whatever answers is
 *  collected, which is why one resolve costs eleven requests and why any single
 *  one of them having nothing is normal rather than an error.
 *
 *  Server-side only, and that is a requirement rather than a preference. The
 *  request is made with a `User-Agent`, a `Referer` and an `Origin`, and all
 *  three are on the browser's forbidden-header list — a `fetch` from the page
 *  drops them silently and sends the site's own origin instead. So this runs in
 *  a route handler and the player only ever sees the URLs that come out of it.
 *
 *  ---------------------------------------------------------------------------
 *  Every reply is sealed, and the seal is an obfuscation rather than a secret
 *  ---------------------------------------------------------------------------
 *
 *  This is the second shape this API has had. It used to answer `{encrypted,
 *  data}`, with the payload run through a shuffled Base64 alphabet — undoing
 *  that was a substitution table and nothing else.
 *
 *  It now answers `{d, n, v: 2}`, and `d` is AES-GCM. The key is never
 *  transmitted, and it does not need to be: it is derived from the request, so
 *  both ends can work it out independently. The client picks sixteen random
 *  bytes, Base64urls them with the padding stripped, and sends them as `?_n=`.
 *  The key is `SHA-256("<nonce>|<app key>")`, the IV is the first twelve bytes
 *  of the decoded `d`, and everything after those twelve is ciphertext followed
 *  by the GCM tag.
 *
 *  Three things about that are worth being plain about:
 *
 *    - The `_n` is not optional. Asked without one, the API answers
 *      `403 {"error":"missing or invalid nonce"}` — which is exactly what the
 *      previous version of this file was calling "vidnest is down". It was
 *      never down; it was being asked without a nonce.
 *    - The app key is not a secret. It is a constant in vidnest.fun's own
 *      player bundle, where every visitor can read it, because it has to reach
 *      a browser for the browser to decrypt with. This being reproducible here
 *      is the same arrangement vidrock's key is in — see `vidrock.js` — and it
 *      is why the scheme is obfuscation: it keeps the URLs out of a plain
 *      `curl`, and does not keep them out of anyone who reads the page.
 *    - It stays in this file regardless, and this file is server-side only.
 *      Nothing here is imported by a component and nothing is prefixed
 *      `NEXT_PUBLIC_`.
 *
 *  ---------------------------------------------------------------------------
 *  A title that is not there is an HTTP 502, and that is an ordinary miss
 *  ---------------------------------------------------------------------------
 *
 *  Ask a server for a film it does not carry and it does not answer with an
 *  empty list — it answers `502`, with a Cloudflare error page behind it. Every
 *  server does this, and it is the same `502` a genuinely broken host returns,
 *  so there is nothing to tell them apart and nothing that should: both mean
 *  this server has nothing for this title, which is a normal outcome here and
 *  not a fault. It contributes an empty list like any other server that had
 *  nothing, the provider answers `null`, and the viewer gets the no-source
 *  panel rather than an error.
 *
 *  ---------------------------------------------------------------------------
 *  No subtitles, deliberately
 *  ---------------------------------------------------------------------------
 *
 *  Two of the servers answer with subtitle links and both kinds are dropped.
 *  They arrive as bare paths — `/sub/<base64>` with no host attached — so there
 *  is nothing here to fetch and nothing a browser could play either. They were
 *  not harmless while they were carried: each one reached the player's captions
 *  menu as an entry that did nothing when it was picked, and the translation
 *  pipeline offered the first of them as its source, so every job spent a fetch
 *  failing before falling back to the source that works.
 *
 *  This site has a subtitle pipeline of its own — see `src/lib/subtitles/` —
 *  and it is what a title gets. A provider that brings a subtitle worth having
 *  is still welcome to; this one does not, so it does not claim to.
 * ============================================================================
 */

/** Where the API lives. `new.` is the API host; `vidnest.fun` is the site. */
const API_BASE_URL = 'https://new.vidnest.fun';

/** The origin the API expects to be asked from, and what the hosts key on. */
const BASE_URL = 'https://vidnest.fun';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${BASE_URL}/`,
  Origin: BASE_URL,
};

/**
 * The key the sealed replies are derived from — see the header.
 *
 * Published in vidnest.fun's own bundle rather than guessed at, and public in
 * the same way that one is: it has to be, for a browser to decrypt with it. It
 * is here rather than in a `.env` because it is not a credential and pretending
 * otherwise would make it look like one that had been lost.
 */
const APP_KEY = 'wSnEvGgWkkxb7nO1yyFgMxhDvogX_Q7Dr0Fi1E4qvn0';

/** How many random bytes a nonce is. Sixteen, as the client uses. */
const NONCE_BYTES = 16;

/** AES-GCM's IV length, which is also where the sealed payload's IV ends. */
const IV_BYTES = 12;

/** Base64url without padding, which is the form the API is given and sends. */
function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(standard + '='.repeat((4 - (standard.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** This request's nonce, in the form the API wants it on the query string. */
function newNonce() {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

/**
 * The key for one exchange, from the nonce the request carried.
 *
 * Per request rather than cached, because the nonce is what it is derived from
 * and every request has its own — eleven of these for a resolve, which is one
 * hash and one import each and not worth arranging around.
 */
async function sealingKey(nonce) {
  const material = new TextEncoder().encode(`${nonce}|${APP_KEY}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', material);
  return globalThis.crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
}

/**
 * A sealed reply, opened.
 *
 * The length check is here rather than left to `decrypt` because a payload
 * shorter than an IV and a tag is not one at all, and the error `decrypt` raises
 * for it says nothing about which of the two things went wrong.
 */
async function unseal(sealed, nonce) {
  const bytes = fromBase64Url(sealed);
  if (bytes.length < IV_BYTES + 16) throw new Error('The sealed payload is too short to be one.');

  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) },
    await sealingKey(nonce),
    bytes.subarray(IV_BYTES),
  );

  return new TextDecoder().decode(plain);
}

/**
 * The servers, in the order their answers are offered in.
 *
 * Which of them has a given title varies by title and by the hour — on one film
 * one or two reply and the rest 502, on another none do, and a server that
 * looks dead today answers tomorrow — so this is a fan-out rather than a
 * preference order, and every one of them is asked every time.
 *
 * The order still matters, though, and not for the reason it looks like. Only
 * the *first* stream is the one that decides whether this provider plays at all
 * — the compare measures it, and the player attaches it — and the servers with
 * nothing for the title are already gone by the time this list is read, because
 * a server that 502s contributes nothing. So the order below is a guess at
 * which server is most likely to answer *and* to answer with something worth
 * playing.
 *
 * Two are missing from it on purpose, and this is the note that stops them
 * being put back: `yflix` and `rogflix`. Measured on a full-length film, every
 * segment of the first one's 1753-segment playlist and the second one's
 * 701-segment playlist was a PNG image — the bytes begin with the PNG signature
 * and go on being a picture — under a master playlist advertising
 * `RESOLUTION=1920x784`. That is not a stream but a placeholder served to
 * something that is not the source's own player, and it is a specific kind of
 * dangerous here: it measures 1920, so as the first source it wins the compare
 * against another provider's real 1080p and then plays a slideshow. Coverage
 * from it was worth nothing, so it was dropped.
 *
 * `onehd` is asked but not relied on for the same sort of reason: it answers
 * with a path — `/hls/<base64>` — to be resolved against a
 * `streamed-*.workers.dev` host it never names, and the target behind that
 * wrapper has refused every request this project has made to it. A stream with
 * no host is not a stream, so `streamFrom` drops it, and the entry costs one
 * request and yields nothing. It stays because a server that answers with a
 * real URL should be taken, and there is no way to know it has started to
 * without asking.
 */
const SERVERS = [
  'nextgencloudfabric',
   'hollymoviehd',
  'klikxxi',
  'rpmvid',
  'allmovies',
  'vidlink',
  'flixhq',
 // 'vidzee',
  'onehd',
  'yflix',
  'rogflix',
];

/**
 * How long any single server gets before it is dropped.
 *
 * Deliberately shorter than it looks like it should be. Eleven servers are
 * asked at once and the slowest one decides how long the whole answer takes,
 * and the whole answer is not judged on its own clock: `resolveBestPlayback`
 * gives every provider five seconds, so a fan-out that finishes in six has
 * finished too late and contributes nothing, however good the servers that
 * replied in the first three hundred milliseconds were. That is not
 * hypothetical — one of these answers in seven seconds on a good day.
 *
 * Four seconds leaves room for the round trip either side of this and still
 * ends inside the caller's deadline. Anything slower than that is not a source
 * worth defaulting to, whatever it eventually says.
 */
const SERVER_TIMEOUT_MS = 4000;

/**
 * The one header pair worth carrying to a stream host, if a server names one.
 *
 * These are the servers' own `Referer` and `Origin`, and they are per stream
 * rather than per provider: the hosts behind this API are not one family, and
 * one title's playlist can want `pwcloud.animanga.fun` while the next wants
 * `goodstream.cc`. They travel to the client as part of the stream and end up
 * on the proxy's query string — see `src/app/api/vidnest/proxy/route.js`.
 *
 * `User-Agent` and `Connection` are dropped even though some servers send them.
 * The first is ours to set and the proxy sets it; the second is hop-by-hop and
 * is refused outright by `fetch`.
 */
const CARRIED_HEADERS = ['referer', 'origin'];

/** Whatever a server called its headers, as the two we will carry. */
function carriedHeaders(raw) {
  const headers = {};
  if (!raw || typeof raw !== 'object') return headers;

  for (const name of CARRIED_HEADERS) {
    const value = raw[name] ?? raw[name[0].toUpperCase() + name.slice(1)];
    if (typeof value !== 'string') continue;

    try {
      // Only https survives, and it is normalised on the way through: these
      // become headers on a request our own server makes, so a value that is
      // not a URL is not a header this should be carrying.
      const url = new URL(value);
      if (url.protocol === 'https:') headers[name] = url.href;
    } catch {
      /* not a URL, so not a Referer */
    }
  }

  return headers;
}

/** A url field, whatever this server decided to call it. */
function urlOf(raw) {
  for (const key of ['url', 'file', 'link', 'playlist']) {
    if (typeof raw[key] === 'string' && raw[key].length > 0) return raw[key];
  }
  return null;
}

/**
 * One entry of a reply, as a stream — or nothing, when it is not one.
 *
 * The absolute-URL rule is here and it is the only filter in this file. A
 * stream the browser cannot reach is not a stream, and a relative path is the
 * shape that says so: there is no host in it and none supplied beside it, so
 * there is nothing to hand the player and nothing for the proxy to fetch. See
 * `onehd` in `SERVERS` for the one server that sends them and why.
 */
function streamFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const url = urlOf(raw);
  if (!url || !/^https:\/\//i.test(url)) return null;

  return {
    url,
    type: typeof raw.type === 'string' ? raw.type : null,
    headers: carriedHeaders(raw.headers),
  };
}

/**
 * Every stream a reply is offering, whatever shape it arrived in.
 *
 * The previous version of this file had a `switch` on the server name, with a
 * branch per reply shape, because in v1 they really were that different — one
 * nested its playlist three deep under `data.stream`. v2 is much more uniform,
 * and the shapes that remain are few enough to describe: a single stream at the
 * top level, or a list under `streams`, or a list under `sources`. Which of the
 * three a given server uses is stable but not worth a table, because the
 * tolerant reading below gets all of them and the one that nests its stream one
 * deeper still.
 *
 * A shape nothing here recognises contributes nothing. That is the intended
 * failure: an API that changes under us loses one server, not the resolve.
 *
 * @returns {Array<{url: string, type: string|null, headers: object}>}
 */
function streamsFrom(payload) {
  if (Array.isArray(payload)) return payload.map(streamFrom).filter(Boolean);
  if (!payload || typeof payload !== 'object') return [];

  for (const key of ['streams', 'sources']) {
    if (Array.isArray(payload[key])) return payload[key].map(streamFrom).filter(Boolean);
  }

  if (payload.data?.stream) return [streamFrom(payload.data.stream)].filter(Boolean);

  return [streamFrom(payload)].filter(Boolean);
}

export async function inspectVidnest({
  tmdbId,
  mediaType = 'movie',
  season = null,
  episode = null,
  signal,
}) {
  if (!tmdbId) throw new Error('tmdbId is required for VidNest');

  /**
   * One server, asked under its own deadline, answering with whatever it has.
   *
   * It never throws and never rejects, which is the point: the ways this fails
   * are a timeout, an abort, a 502 for a title the server does not carry, a
   * payload that will not unseal, and a shape nothing recognises, and every one
   * of them means the same thing here — this server contributed nothing. Giving
   * them five different treatments to arrive back at one outcome would be
   * spelling out a distinction that does not exist.
   *
   * The abort is wired to two things: our own deadline, and the caller's
   * signal, which is the request's — so a viewer who closes the player or
   * switches source mid-resolve tears down all eleven in-flight requests rather
   * than leaving them to run out the clock.
   */
  async function askServer(path) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const nonce = newNonce();
      const suffix =
        mediaType === 'tv' ? `/tv/${tmdbId}/${season}/${episode}` : `/movie/${tmdbId}`;

      const response = await fetch(`${API_BASE_URL}/${path}${suffix}?_n=${nonce}`, {
        headers: HEADERS,
        cache: 'no-store',
        signal: controller.signal,
      });

      // The 502 that means "not this title" — see the header. Nothing to
      // separate it from a host that is genuinely down, and nothing that wants
      // to: both are this server having nothing.
      if (!response.ok) return [];

      const reply = await response.json();
      if (reply?.v !== 2 || typeof reply.d !== 'string') return [];

      return streamsFrom(JSON.parse(await unseal(reply.d, nonce)));
    } catch {
      return [];
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  const answers = await Promise.all(SERVERS.map(askServer));

  return { provider: 'vidnest', streams: answers.flat() };
}
