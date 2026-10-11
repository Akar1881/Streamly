/**
 * ============================================================================
 *  VIDROCK — the lookup
 * ============================================================================
 *  The API answers at `https://vidrock.net/api/movie/{tmdbId}`, and at
 *  `.../tv/{tmdbId}/{season}/{episode}` for an episode, with an object keyed by
 *  the name of each server it knows about:
 *
 *    { "Nova": { url, language, flag, type }, "Atlas": {...}, "Luna": {...}, … }
 *
 *  This has to run on the server, and not because of anything about the reply:
 *  the API wants a `Referer` and an `Origin`, and both are on the browser's
 *  forbidden-header list, so a page that asked would arrive anonymously and be
 *  answered as such.
 *
 *  ---------------------------------------------------------------------------
 *  The URLs are sealed, and the key is theirs to look up
 *  ---------------------------------------------------------------------------
 *
 *  `url` is not a URL. It is the address, encrypted — AES-GCM under a key that
 *  is a hardcoded constant in vidrock's own player bundle, with the IV in the
 *  first twelve bytes and the whole thing base64url'd. That reads like a defence
 *  and is not one: the key has to reach the browser for the player to work at
 *  all, so it is published in a file anyone can fetch, and sealing the address
 *  only stops it being read off the API reply without also reading that file.
 *  It is unsealed here, which is what makes this provider possible at all.
 *
 *  Nothing about the scheme is ours to choose, so the version of it that lives
 *  here is written out plainly rather than split across helpers with opinions:
 *  the key, the twelve bytes, the rest.
 *
 *  ---------------------------------------------------------------------------
 *  One server, and it is not the first one
 *  ---------------------------------------------------------------------------
 *
 *  Five servers come back and four of them are not worth carrying:
 *
 *    Nova    answers with a playlist named `bigtits.m3u8` whose segments are
 *            PNG images — two megabytes each, a slideshow of stills with the
 *            running time of the film. It is a plausible-looking answer that
 *            plays as a slideshow, which is worse than no answer.
 *    Orion   is behind Cloudflare, which returns a 403 and an HTML page for
 *            every rung of every playlist, on every host it rotates through.
 *            One master playlist in every few dozen attempts slips through,
 *            and its children are refused, so it never plays.
 *    Luna    has come back with `url: null` every time it has been asked.
 *    Astra   the same.
 *
 *  Atlas is a real stream: MPEG-TS segments, ten seconds each, and a count that
 *  adds up to the runtime of the film that was asked for. It is the only server
 *  here that has ever answered with the picture rather than a stand-in for it,
 *  so it is the only one read. The others are named here rather than merely
 *  omitted because the omission is the decision.
 *
 *  ---------------------------------------------------------------------------
 *  The streams need our proxy, and the subtitles are not taken
 *  ---------------------------------------------------------------------------
 *
 *  Atlas's hosts want a `Referer`, and its segments are CORS-gated to
 *  `https://vidrock.net`, so a browser on this site can read neither. Both are
 *  the reason `src/app/api/vidrock/proxy/route.js` exists.
 *
 *  Vidrock does offer subtitles, on a second host that needs no headers at all
 *  — 106 tracks for one film, `Access-Control-Allow-Origin: *`, reachable and
 *  playable. They are not taken anyway. There is no Kurdish among them, the
 *  English tracks run nine deep with the same dialogue repeated, and the first
 *  cue of each is an advertisement for the service itself — "Visit hoofoot.ru
 *  to watch all sports livestream and highlights for free", six seconds in. The
 *  site's own pipeline finds a subtitle without any of that, which is what every
 *  viewer was getting before this provider existed.
 * ============================================================================
 */

/**
 * What viewers are told this source is called. The real name lives here and in
 * the filename, and reaches nobody but us — see the contract in `index.js`.
 */
const API_BASE_URL = 'https://vidrock.net';

/**
 * The server to read. See the header for why it is the only one.
 */
const SERVER = 'Atlas';

/**
 * The headers the API is asked with, as close to a browser's as they can be
 * made from a function.
 *
 * `Referer` and `Origin` were once load-bearing — measured, either one of them
 * turned a 403 into a 200 — and they are sent still, though the API answers
 * without them now. What the rest of the set is for is the other gate:
 * Cloudflare in front of `vidrock.net` answers 403 to the datacenter addresses
 * a serverless host egresses from, and a request carrying a browser's
 * `sec-ch-ua`/`sec-fetch-*` fingerprint is the lever a function has against it.
 * The `User-Agent` and `sec-ch-ua` versions are written from one constant
 * because a pair that disagrees is itself the kind of tell this is trying to
 * avoid.
 */
const CHROME_MAJOR = '155';

const HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${API_BASE_URL}/`,
  Origin: API_BASE_URL,
  'User-Agent': `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
  'sec-ch-ua': `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not(A:Brand";v="24"`,
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

/**
 * The AES-GCM key, as their player bundle writes it.
 *
 * A hex string rather than bytes because that is how it arrives. It is not a
 * secret — it cannot be, since the browser needs it — so copying it here is
 * reading a public file, not taking a credential.
 */
const KEY_HEX = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';

const LOOKUP_TIMEOUT_MS = 8000;
const MAX_LOOKUP_ATTEMPTS = 2;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** The key, as bytes. */
function keyBytes() {
  const bytes = new Uint8Array(KEY_HEX.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(KEY_HEX.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * The imported key, kept once it exists.
 *
 * `importKey` is the expensive half of a decryption and the key never changes,
 * so it is done on the first call and held. A promise rather than the key itself
 * because two lookups can overlap, and both would otherwise import it.
 */
let pendingKey = null;

function decryptionKey() {
  pendingKey ??= globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes(),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  return pendingKey;
}

/**
 * base64url to bytes.
 *
 * The alphabet swaps `+` and `/` for `-` and `_`, and the padding is dropped —
 * which is why the length has to be checked rather than trusted. A remainder of
 * one cannot come from any input, so it means the string is not base64 at all.
 */
function base64Url(value) {
  const standard = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const remainder = standard.length % 4;
  if (remainder === 1) throw new Error('The sealed URL is not base64url.');

  const padded = standard + (remainder === 2 ? '==' : remainder === 3 ? '=' : '');
  const binary = atob(padded);

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * A sealed address, opened.
 *
 * Twelve bytes of IV, then the ciphertext and its authentication tag together —
 * which is where the length check comes from: a tag is sixteen bytes and an IV
 * is twelve, so anything under twenty-eight cannot be a sealed URL no matter
 * what it decrypts to.
 */
async function unseal(sealed) {
  const bytes = base64Url(sealed);
  if (bytes.length < 28) throw new Error('The sealed URL is too short to be one.');

  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
    await decryptionKey(),
    bytes.subarray(12),
  );

  return new TextDecoder().decode(plain);
}

/**
 * What vidrock has for a title.
 *
 * @returns {Promise<{streams: Array<{url: string, type: string}>}>} an empty
 *          list for an ordinary miss, which is most titles: the API answers 200
 *          with a key for every server whether or not it has anything, so a
 *          missing, empty or unattributable `url` is the shape a miss arrives
 *          in rather than an error worth throwing.
 */
export async function inspectVidrock({
  tmdbId,
  mediaType = 'movie',
  season = null,
  episode = null,
  signal,
}) {
  if (!tmdbId) throw new Error('tmdbId is required for Vidrock');

  const path =
    mediaType === 'tv' ? `/api/tv/${tmdbId}/${season}/${episode}` : `/api/movie/${tmdbId}`;

  for (let attempt = 1; attempt <= MAX_LOOKUP_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) controller.abort();

    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LOOKUP_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: HEADERS,
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        if (attempt < MAX_LOOKUP_ATTEMPTS && RETRYABLE_STATUSES.has(response.status)) continue;
        throw new Error(`Vidrock answered ${response.status}`);
      }

      const sealed = (await response.json())?.[SERVER]?.url;
      if (typeof sealed !== 'string' || sealed.length === 0) return { streams: [] };

      const url = await unseal(sealed);

      // A sealed address that does not open into an https URL is a shape we do
      // not understand — a change on their side, most likely. That is a miss and
      // not a fault: the viewer gets the other providers, which is what they
      // would have got had this one never been added.
      if (!/^https:\/\//.test(url)) return { streams: [] };

      return { streams: [{ url, type: 'application/x-mpegURL' }] };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timedOut) {
        throw Object.assign(new Error('Vidrock lookup timed out.'), { code: 'VIDROCK_TIMEOUT' });
      }
      if (attempt < MAX_LOOKUP_ATTEMPTS && error?.name !== 'AbortError') continue;
      throw error;
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  return { streams: [] };
}
