/**
 * ============================================================================
 *  VIDNEST — the lookup
 * ============================================================================
 *  One title in, a list of streams out. Vidnest is not a host but a fan-out:
 *  ten upstream servers are asked in parallel and whatever answers is collected,
 *  which is why one resolve costs ten requests and why an individual server
 *  being down is normal rather than an error.
 *
 *  Server-side only, and that is a requirement rather than a preference. The
 *  request is made with a `User-Agent`, a `Referer` and an `Origin`, and all
 *  three are on the browser's forbidden-header list — a `fetch` from the page
 *  drops them silently and sends the site's own origin instead. So this runs in
 *  a route handler and the player only ever sees the URLs that come out of it.
 *
 *  Every reply is encrypted with a shuffled Base64 alphabet and has to be
 *  decoded before it is JSON at all — `decodeVidnestBase64` below. Nothing here
 *  is a secret; it is obfuscation, and it is undone the same way it is done.
 *
 *  What comes back is HLS, and the playlists that matter are masters: the one
 *  that works is a Cloudflare Worker that fronts an upstream host, injects the
 *  `Referer` that host demands, and echoes back our `Origin` — so the browser
 *  can fetch it directly and none of the ten servers' own headers travel with
 *  the stream. That is why a source here carries no `headers`.
 * ============================================================================
 */

// The alphabet is the ordinary Base64 one with the last two characters moved to
// the front and everything else permuted. Only the substitution matters.
const VIDNEST_ALPHABET = 'RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=';

const VIDNEST_REVERSE_MAP = (() => {
    const map = {};
    for (let i = 0; i < VIDNEST_ALPHABET.length; i++) {
        map[VIDNEST_ALPHABET[i]] = i;
    }
    return map;
})();

function decodeVidnestBase64(input) {
    if (!input || typeof input !== 'string') {
        throw new Error('VidNest: invalid payload, expected non-empty string');
    }

    let padded = input;
    const mod = padded.length % 4;
    if (mod !== 0) {
        padded += '='.repeat(4 - mod);
    }

    const bytes = [];

    for (let i = 0; i < padded.length; i += 4) {
        const chunk = padded.slice(i, i + 4);

        let c0 = VIDNEST_REVERSE_MAP[chunk[0]] ?? 64;
        let c1 = VIDNEST_REVERSE_MAP[chunk[1]] ?? 64;
        let c2 = chunk[2] === '=' ? 64 : (VIDNEST_REVERSE_MAP[chunk[2]] ?? 64);
        let c3 = chunk[3] === '=' ? 64 : (VIDNEST_REVERSE_MAP[chunk[3]] ?? 64);

        bytes.push(((c0 << 2) | (c1 >> 4)) & 0xff);

        if (c2 !== 64) {
            bytes.push((((c1 & 0x0f) << 4) | (c2 >> 2)) & 0xff);
        }

        if (c3 !== 64) {
            bytes.push((((c2 & 0x03) << 6) | c3) & 0xff);
        }
    }

    const decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(bytes));
}

function decrypt(payload) {
    try {
        return JSON.parse(decodeVidnestBase64(payload));
    } catch {
        throw new Error('VidNest: failed to parse decrypted payload as JSON');
    }
}

const API_BASE_URL = 'https://new.vidnest.fun';
const BASE_URL = 'https://vidnest.fun';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${BASE_URL}/`,
    'Origin': BASE_URL
};

const SERVERS = [
    { path: 'moviebox', query: '' },
    { path: 'allmovies', query: '' },
    { path: 'catflix', query: '' },
    { path: 'purstream', query: '' },
    { path: 'hollymoviehd', query: '' },
    { path: 'lamda', query: '' },
    { path: 'flixhq', query: '' },
    { path: 'vidlink', query: '' },
    { path: 'onehd', query: '?server=upcloud' },
    { path: 'klikxxi', query: '' }
];

/**
 * How long any single server gets before it is dropped.
 *
 * Ten servers are asked at once, so the slowest one decides how long a viewer
 * waits, and a fan-out like this reliably has one host that accepts the
 * connection and then says nothing — it never errors, so `allSettled` never
 * settles and the request hangs until the runtime's own limit. A per-server
 * deadline turns that from "the resolve never finishes" into "that one server
 * contributed nothing", which is the normal outcome here anyway. Eight seconds
 * is generous next to the two seconds this usually takes.
 */
const SERVER_TIMEOUT_MS = 8000;

export async function inspectVidnest({
    tmdbId,
    mediaType = 'movie',
    season = null,
    episode = null,
    signal,
}) {
    if (!tmdbId) throw new Error('tmdbId is required for VidNest');

    const sources = [];
    const subtitles = [];

    /**
     * A server that answers nothing loses, but it loses on its own.
     *
     * The abort is wired to two things: our own deadline, and the caller's
     * signal — which is the request's, so a viewer who closes the player or
     * switches source mid-resolve tears down all ten in-flight requests instead
     * of leaving them to run out the clock.
     */
    async function askServer(server) {
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
        const forwardAbort = () => controller.abort();
        signal?.addEventListener('abort', forwardAbort, { once: true });

        try {
            const url =
                mediaType === 'movie'
                    ? `${API_BASE_URL}/${server.path}/movie/${tmdbId}${server.query}`
                    : `${API_BASE_URL}/${server.path}/tv/${tmdbId}/${season}/${episode}${server.query}`;

            const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
            if (!res.ok) return null;
            const json = await res.json();

            if (!json.encrypted || !json.data) return null;

            const decrypted = decrypt(json.data);
            return { server: server.path, data: decrypted };
        } catch {
            // A timeout, an abort, a dead host and a payload that will not
            // decrypt all land here for the same reason: this server has no
            // stream for this title. There is nothing to distinguish them.
            return null;
        } finally {
            clearTimeout(deadline);
            signal?.removeEventListener('abort', forwardAbort);
        }
    }

    const promises = SERVERS.map(askServer);

    const results = await Promise.allSettled(promises);

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            const { server, data } = result.value;
            const parsed = parseServerResponse(server, data);
            sources.push(...parsed.streams);
            subtitles.push(...parsed.subtitles);
        }
    }

    return {
        provider: 'vidnest',
        streams: sources,
        subtitles
    };
}

function parseServerResponse(serverName, data) {
    const streams = [];
    const subtitles = [];

    if (!data) return { streams, subtitles };

    switch (serverName) {
        case 'klikxxi':
            if (data.sources && Array.isArray(data.sources)) {
                data.sources.forEach(s => streams.push({ provider: serverName, quality: s.quality || 'Auto', url: s.url, type: s.type || 'hls' }));
            }
            break;
        case 'allmovies':
        case 'delta':
            if (data.streams && Array.isArray(data.streams)) {
                data.streams.forEach(s => streams.push({ provider: serverName, quality: 'Auto', url: s.url, type: s.type || 'hls', language: s.language }));
            }
            break;
        case 'hollymoviehd':
            if (data.sources && Array.isArray(data.sources)) {
                data.sources.forEach(s => streams.push({ provider: serverName, quality: s.label || 'Auto', url: s.file, type: s.type || 'hls' }));
            }
            break;
        case 'vidlink':
            if (data.data?.stream?.playlist) {
                streams.push({ provider: serverName, quality: 'Auto', url: data.data.stream.playlist, type: data.data.stream.type || 'hls' });
            }
            if (data.data?.stream?.captions && Array.isArray(data.data.stream.captions)) {
                data.data.stream.captions.forEach(c => subtitles.push({
                    server: serverName,
                    url: c.url,
                    lang: c.language,
                    format: c.url.includes('.srt') ? 'srt' : 'vtt'
                }));
            }
            break;
        case 'onehd':
            if (data.url) {
                streams.push({ provider: serverName, quality: 'Auto', url: data.url, type: 'hls' });
            }
            if (data.subtitles && Array.isArray(data.subtitles)) {
                data.subtitles.forEach(sub => subtitles.push({
                    server: serverName,
                    url: sub.url,
                    lang: sub.lang,
                    format: sub.url.includes('.srt') ? 'srt' : 'vtt'
                }));
            }
            break;
        case 'moviebox':
            if (data.url && Array.isArray(data.url)) {
                data.url.forEach(u => streams.push({ provider: serverName, quality: u.resolution || 'Auto', url: u.link, type: u.type || 'hls' }));
            }
            break;
        default:
            if (data.url) {
                streams.push({ provider: serverName, quality: 'Auto', url: data.url, type: 'hls' });
            }
            break;
    }

    return { streams, subtitles };
}