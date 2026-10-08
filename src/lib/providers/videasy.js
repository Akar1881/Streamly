// lib/videasy.js

const BASE_URL = 'https://player.videasy.ws';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://player.videasy.ws/',
    'Origin': 'https://player.videasy.ws'
};

function decodeHtml(value) {
    if (!value) return '';
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function b64(s) {
    return Buffer.from(s, 'base64');
}

async function decryptStreamUrls(vs, encB64, signal) {
    let wasmUrl = vs.wasm_url;
    if (wasmUrl && wasmUrl.startsWith('/')) {
        wasmUrl = `https://data.vidsrc.sh${wasmUrl}`;
    }

    console.log(`[10] Downloading WASM decryptor: ${wasmUrl}`);
    const wasmRes = await fetch(wasmUrl, {
        headers: { 'Referer': 'https://data.vidsrc.sh/' },
        signal
    });
    if (!wasmRes.ok) throw new Error(`WASM request failed: ${wasmRes.status}`);
    const wasmBuffer = await wasmRes.arrayBuffer();

    const mod = await WebAssembly.compile(wasmBuffer);
    const inst = await WebAssembly.instantiate(mod, {});
    const ex = inst.exports;

    const enc = b64(encB64);
    const ptr = ex.alloc(enc.length);

    const memoryBytes = new Uint8Array(ex.memory.buffer);
    memoryBytes.set(enc, ptr);

    const outLen = ex.decrypt(ptr, enc.length);
    const decryptedBytes = new Uint8Array(ex.memory.buffer, ptr + 12, outLen);
    const decodedStr = new TextDecoder().decode(decryptedBytes);

    return decodedStr.split('\n').filter(Boolean);
}

function parseCfgFromHtml(html, sourceUrl) {
    const cfgMatch = html.match(/window\.CFG\s*=\s*({[\s\S]*?});?\s*<\/script>/i) ||
        html.match(/window\.CFG\s*=\s*({[\s\S]*?});/i);
    if (!cfgMatch) throw new Error('window.CFG not found in host HTML body.');
    let cfgJsonStr = cfgMatch[1].replace(/\\u0026/g, '&');
    try {
        return JSON.parse(cfgJsonStr);
    } catch {
        return (new Function(`return ${cfgJsonStr}`))();
    }
}

function parseConfigFromHtml(html) {
    const configMatch = html.match(/window\.CONFIG\s*=\s*({[\s\S]*?});?\s*<\/script>/i) ||
        html.match(/window\.CONFIG\s*=\s*({[\s\S]*?});/i);
    if (!configMatch) throw new Error('window.CONFIG not found in player HTML body.');
    let configJsonStr = configMatch[1].replace(/\\u0026/g, '&');
    try {
        return JSON.parse(configJsonStr);
    } catch {
        return (new Function(`return ${configJsonStr}`))();
    }
}

export async function inspectVideasy(tmdbId, {
    mediaType = 'movie',
    season,
    episode,
    signal
} = {}) {
    tmdbId = String(tmdbId);
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new Error('Unsupported media type.');
    if (mediaType === 'tv' && (!Number.isInteger(Number(season)) || !Number.isInteger(Number(episode)))) {
        throw new Error('TV playback requires a season and episode.');
    }
    const path = mediaType === 'tv'
        ? `tv/${tmdbId}/${Number(season)}/${Number(episode)}`
        : `movie/${tmdbId}`;
    const embedUrl = `${BASE_URL}/embed/${path}`;

    console.log(`[1] Fetching Videasy embed: ${embedUrl}`);
    const embedRes = await fetch(embedUrl, { headers: HEADERS, signal });
    if (!embedRes.ok) throw new Error(`Embed request failed: ${embedRes.status}`);
    const html = await embedRes.text();

    const match = html.match(/id=["']player_iframe["'][^>]*data-api=["']([^"']+)["']/i) ||
        html.match(/data-api=["']([^"']+)["']/i) ||
        html.match(/src=["']([^"']+\/vs_src\.php[^"']*)["']/i);

    if (!match) throw new Error('Could not find data-api endpoint in embed HTML.');

    const apiUrl = new URL(decodeHtml(match[1]), BASE_URL).href;
    console.log(`[2] Found Source API: ${apiUrl}`);

    console.log(`[3] Fetching Source API JSON...`);
    const apiRes = await fetch(apiUrl, {
        headers: { ...HEADERS, 'Accept': 'application/json,text/plain,*/*' },
        signal
    });
    if (!apiRes.ok) throw new Error(`Source API request failed: ${apiRes.status}`);
    const apiBody = await apiRes.json();
    if (!apiBody.src) throw new Error('Source API response did not contain a "src" property.');

    const hostUrl = apiBody.src;
    console.log(`[4] Found Host Embed URL: ${hostUrl}`);

    console.log(`[5] Fetching Host Embed HTML with required headers...`);
    const hostRes = await fetch(hostUrl, {
        headers: { ...HEADERS, 'Referer': `${BASE_URL}/` },
        signal
    });
    if (!hostRes.ok) throw new Error(`Host request failed: ${hostRes.status}`);
    const hostHtml = await hostRes.text();

    console.log(`[6] Parsing window.CFG from host response...`);
    const cfg = parseCfgFromHtml(hostHtml, hostUrl);
    if (!cfg.playerUrl) throw new Error('No playerUrl found in window.CFG');

    const playerFullUrl = new URL(cfg.playerUrl, hostUrl).href;
    console.log(`\n[7] Fetching Player URL: ${playerFullUrl}`);

    const playerRes = await fetch(playerFullUrl, {
        headers: { ...HEADERS, 'Referer': hostUrl },
        signal
    });
    console.log(`Player response status: ${playerRes.status}`);
    const playerBody = await playerRes.text();

    console.log(`[8] Parsing window.CONFIG from player response...`);
    const playerConfig = parseConfigFromHtml(playerBody);

    const configuredApi = playerConfig.api || (
        mediaType === 'tv' && playerConfig.streamBase
            ? `${playerConfig.streamBase}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}&stream_urls`
            : null
    );
    if (!configuredApi) {
        throw new Error('No api property found in window.CONFIG');
    }

    let streamApiUrl = configuredApi.replace(/\\u0026/g, '&');
    if (playerConfig.apiToken) {
        streamApiUrl += `&api_token=${encodeURIComponent(playerConfig.apiToken)}`;
    }

    console.log(`\n[9] Fetching Stream Data API: ${streamApiUrl}`);

    const hostOrigin = new URL(hostUrl).origin;
    const streamRes = await fetch(streamApiUrl, {
        headers: {
            ...HEADERS,
            'Accept': 'application/json,text/plain,*/*',
            'Referer': playerFullUrl,
            'Origin': hostOrigin,
            ...(playerConfig.apiToken ? {
                'Authorization': `Bearer ${playerConfig.apiToken}`,
                'X-API-Token': playerConfig.apiToken
            } : {})
        },
        signal
    });

    console.log(`Stream API status: ${streamRes.status}`);
    const streamData = await streamRes.json();

    let rawStreamUrls = [];
    if (streamData && streamData.vs && streamData.data && typeof streamData.data.stream_urls === 'string') {
        rawStreamUrls = await decryptStreamUrls(streamData.vs, streamData.data.stream_urls, signal);
    } else if (streamData && Array.isArray(streamData.data?.stream_urls)) {
        rawStreamUrls = streamData.data.stream_urls;
    } else if (Array.isArray(streamData.stream_urls)) {
        rawStreamUrls = streamData.stream_urls;
    }

    const streamUrls = rawStreamUrls.map(url => {
        if (!playerConfig.apiToken) return url;
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}api_token=${encodeURIComponent(playerConfig.apiToken)}`;
    });

    return {
        hostUrl,
        playerFullUrl,
        origin: new URL(hostUrl).origin,
        playerConfig,
        streamUrls
    };
}