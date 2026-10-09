/**
 * ============================================================================
 *  VIDROCK — the lookup
 * ============================================================================
 *  One title in, a handful of streams and a very large subtitle list out.
 *
 *  Server-side only, and this one has two separate reasons rather than one.
 *  The lookup sends a `Referer`, an `Origin` and a `User-Agent` that a browser
 *  drops on the forbidden-header list, the same as everywhere else here. But the
 *  *streams* it hands back need those headers too — the segment hosts return 404
 *  without a referer and send no CORS header at all — so a viewer could not fetch
 *  them even with the URL in hand. The URLs this returns are therefore meant to
 *  be wrapped by the proxy before they reach a player, which is what
 *  `vidrock-provider.js` does.
 *
 *  The API does not return URLs at all. It returns per-server tokens, each an
 *  AES-GCM ciphertext of the real URL: the first twelve bytes are the nonce and
 *  the rest is the sealed message, and the key is a hex string sitting in their
 *  own JavaScript bundle (`/assets/index-*.js`, as `TQ`) for anyone who looks.
 *  That is obfuscation rather than security, the same as the shuffled Base64
 *  alphabet in `vidnest.js`, and it is undone here the same way it is done there
 *  — the browser can decrypt it, so this can too.
 *
 *  Two of the five servers are usually empty and one is a dead end, but the two
 *  that do answer are both real video — and neither is playable as it comes.
 *  One needs the referer the browser cannot send; the other serves its segments
 *  behind a seventy-byte PNG header. Both of those are the proxy's problem, and
 *  `src/app/api/vidrock/proxy/route.js` is where they are dealt with.
 * ============================================================================
 */

const BASE_URL = 'https://vidrock.net';
const SUB_BASE_URL = 'https://sub.vdrk.site';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
    'Accept': 'application/json, text/javascript, *,*/*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${BASE_URL}/`,
    'Origin': BASE_URL
};

/**
 * The AES-GCM key, as it is written in their bundle.
 *
 * 64 hex characters, so 32 bytes, which is what AES-256 wants. Base64 rather
 * than derived from anything — there is no handshake to keep up with, and a
 * key that never rotates is the reason this can be a constant.
 */
const STREAM_KEY = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';

/**
 * How long any single request gets.
 *
 * The subtitle list for a popular film is a few hundred kilobytes and the
 * lookup is one request, so nothing here is slow — but nothing here defends
 * itself either, and a title with no subtitles must still play.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Hex text to bytes. */
function fromHex(text) {
    const bytes = new Uint8Array(text.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = parseInt(text.substr(i * 2, 2), 16);
    }
    return bytes;
}

/**
 * Their base64url to bytes.
 *
 * The alphabet is the ordinary url-safe one, so this is `Buffer.from` once the
 * padding is put back — which it has to be done by hand, because they strip it
 * and Node's decoder needs it.
 */
function fromBase64Url(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const remainder = padded.length % 4;
    if (remainder === 1) throw new Error('VidRock: malformed stream token');

    return new Uint8Array(
        Buffer.from(remainder ? padded + '='.repeat(4 - remainder) : padded, 'base64'),
    );
}

/** The key, imported once per process rather than per stream. */
let streamKey = null;

async function importStreamKey() {
    if (!streamKey) {
        streamKey = await crypto.subtle.importKey(
            'raw',
            fromHex(STREAM_KEY),
            { name: 'AES-GCM' },
            false,
            ['decrypt'],
        );
    }
    return streamKey;
}

/**
 * A server's token, opened into the URL it points at.
 *
 * GCM is authenticated, so a token that was tampered with fails here rather
 * than decrypting into a URL of someone else's choosing — which is the one
 * property worth having, given the result is handed to a player.
 */
async function decryptStreamUrl(token) {
    const sealed = fromBase64Url(token);
    if (sealed.length < 28) throw new Error('VidRock: stream token too short');

    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.slice(0, 12) },
        await importStreamKey(),
        sealed.slice(12),
    );

    return new TextDecoder().decode(plain);
}

/** A request that gives up rather than holding a watch page open. */
async function fetchWithDeadline(url, { signal, headers = HEADERS } = {}) {
    const controller = new AbortController();
    const relay = () => controller.abort();
    signal?.addEventListener('abort', relay, { once: true });
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        return await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
    } finally {
        clearTimeout(deadline);
        signal?.removeEventListener('abort', relay);
    }
}

/**
 * The streams and subtitles for a title.
 *
 * @returns {Promise<{provider: string, streams: object[], subtitles: object[]}>}
 */
export async function inspectVidrock({ tmdbId, mediaType = 'movie', season = null, episode = null, signal }) {
    if (!tmdbId) throw new Error('tmdbId is required for VidRock');

    const isTv = mediaType === 'tv' || mediaType === 'series';
    const apiUrl = isTv
        ? `${BASE_URL}/api/tv/${tmdbId}/${season}/${episode}`
        : `${BASE_URL}/api/movie/${tmdbId}`;

    const response = await fetchWithDeadline(apiUrl, { signal });
    if (!response.ok) throw new Error(`VidRock HTTP ${response.status}`);

    const payload = await response.json();
    const streams = [];

    for (const [server, entry] of Object.entries(payload ?? {})) {
        if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') continue;

        let url;
        try {
            url = await decryptStreamUrl(entry.url);
        } catch {
            // A token that will not open is one server's problem, not the
            // title's — the others are still worth having.
            continue;
        }

        if (!/^https:\/\//i.test(url)) continue;

        streams.push({
            /**
             * Kept for us, never shown. The viewer is told a codename, and the
             * source menu numbers these; `Nova` and `Atlas` are names of
             * services and do not go in front of anyone. See
             * `src/lib/providers/index.js` for the rule.
             */
            server,
            url,
            language: entry.language ?? null,
            // The response calls everything `hls`, and both hosts that answer
            // serve MPEG-TS playlists, so this is a guess the proxy corrects
            // when it sees the bytes. Left in because a source with no type at
            // all makes `isHls` fall back to sniffing the URL, which is worse.
            type: /\.mp4(\?|$)/i.test(url) ? 'mp4' : 'hls',
        });
    }

    return {
        provider: 'vidrock',
        streams,
        subtitles: await fetchSubtitles({ tmdbId, isTv, season, episode, signal }),
    };
}

/**
 * Every subtitle they have for a title.
 *
 * A different service from the streams — `sub.vdrk.site` to look them up,
 * `cache.vdrk.site` to fetch them — and unlike the streams these are open:
 * the files answer with `Access-Control-Allow-Origin: *` and want no referer,
 * so a player can fetch them directly with no proxy in between.
 *
 * There are a great many of them. A popular film runs to a hundred-odd entries
 * with the duplicates spelled out in the label — `Arabic`, `Arabic2`, `Arabic3`
 * — which is why the label is carried through as a name rather than collapsed
 * to a language and why `lang` is kept as they wrote it. Deciding what to do
 * with that many is the player's job, not this function's.
 */
async function fetchSubtitles({ tmdbId, isTv, season, episode, signal }) {
    const url = isTv
        ? `${SUB_BASE_URL}/v2/tv/${tmdbId}/${season}/${episode}`
        : `${SUB_BASE_URL}/v1/movie/${tmdbId}`;

    try {
        const response = await fetchWithDeadline(url, { signal });
        if (!response.ok) return [];

        const list = await response.json();
        if (!Array.isArray(list)) return [];

        return list
            .filter((entry) => entry && typeof entry.file === 'string' && entry.file.length > 0)
            .map((entry) => ({
                url: entry.file,
                lang: entry.label ?? entry.language ?? 'Unknown',
                format: /\.srt(\?|$)/i.test(entry.file) ? 'srt' : 'vtt',
            }));
    } catch {
        // Subtitles are a bonus on top of the stream. A title that plays
        // without them is a far better outcome than one that does not play.
        return [];
    }
}
