/**
 * ============================================================================
 *  VIDPLAY — the lookup
 * ============================================================================
 *  A chain of redirects behind one embed page. `https://ythd.org/embed/<id>` is
 *  asked for a movie and `.../<tmdbId>/<season>-<episode>` for an episode; the
 *  HTML names a source endpoint in a `data-api` attribute, that endpoint answers
 *  with a `src` URL to a "stellar" host, and that host serves a small page whose
 *  `window.CFG` carries the real player URL. The player page then holds a
 *  `window.CONFIG` with an API token and the stream API's address, and the API
 *  answers with the addresses themselves — encrypted.
 *
 *  ---------------------------------------------------------------------------
 *  The addresses arrive sealed, and the key is a WebAssembly module
 *  ---------------------------------------------------------------------------
 *  `data.stream_urls` is one base64 blob of every address joined by newlines,
 *  encrypted, and the decryptor is a `.wasm` file whose URL comes back beside it
 *  in `vs.wasm_url`. So the last step of the lookup is: compile and instantiate
 *  that module, hand it the blob, read the plaintext out of its linear memory.
 *  It does nothing else — no key exchange, no second secret — the module *is*
 *  the scheme, and it is fetched and run here because a page cannot instantiate
 *  a module from another origin unless that origin opts in, and this one does
 *  not.
 *
 *  ---------------------------------------------------------------------------
 *  Every stream needs a token, and the token is bound to this server's address
 *  ---------------------------------------------------------------------------
 *  A stream address on its own is answered `401 "no token"`. The host mints one
 *  at `/generate.php` on the *stream's* origin — the hosts rotate per title, so
 *  it is asked per origin, not once — and it is a JWT whose claim is the
 *  requesting IP, in a `/24`. That is why neither step of this can move to the
 *  browser: the page has the wrong address for the claim, and `Referer` and
 *  `Origin` are on the browser's forbidden-header list regardless.
 *
 *  The token is not fetched here. The stream URLs leave this function bare and
 *  `src/app/api/vidplay/proxy/route.js` mints one as it fetches — for the same
 *  origin, from the same machine, and re-minted if the host rejects a stale one.
 *  Keeping it there rather than here is what lets a resolve be a plain lookup
 *  with no write side effect, and it is what the other providers do too.
 *
 *  ---------------------------------------------------------------------------
 *  Headers, and the three the embed gate wants
 *  ---------------------------------------------------------------------------
 *  The gate is measured rather than guessed: with `Referer` and `Origin` set to
 *  the site's own address the chain answers, and without them the first embed
 *  request comes back empty. They travel with the request that needs them and
 *  move to the next host's own origin as the chain does.
 * ============================================================================
 */

/** The headers the embed and its source endpoint want. */
const EMBED_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Referer: 'https://vidplay.top',
  Origin: 'https://vidplay.top',
};

const EMBED_BASE_URL = 'https://ythd.org';

/** How long one step of the chain may take before the lookup is called failed. */
const STEP_TIMEOUT_MS = 8_000;

/** base64 to the bytes it names. */
function base64Bytes(value) {
  return new Uint8Array(Buffer.from(String(value), 'base64'));
}

/**
 * One request in the chain, with the caller's signal and a deadline of its own.
 *
 * A provider is asked for every title alongside the others, and a step that
 * hangs would hold the whole comparison open; the deadline is what stops one
 * slow host from spending the viewer's patience on a source they may never see.
 * The caller's signal is relayed rather than passed through so that a viewer
 * leaving the page cancels a body in flight as well as a pending one.
 */
async function fetchStep(url, init, signal) {
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay, { once: true });
  if (signal?.aborted) controller.abort();

  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    controller.abort();
  }, STEP_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Vidplay step answered ${response.status}`);

    return response;
  } catch (error) {
    if (expired && error?.name === 'AbortError') {
      throw Object.assign(new Error('Vidplay took too long to answer.'), {
        code: 'VIDPLAY_TIMEOUT',
      });
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', relay);
  }
}

/**
 * `window.CFG` / `window.CONFIG`, as the player page writes them.
 *
 * Two names for the same shape at two steps of the chain, so one parser serves
 * both. The object is JSON on every page seen, but it is written by hand into a
 * script tag and the `&` spelling of `&` shows up in it, so the first parse
 * is given a reason and the second — evaluating it — is the fallback for the day
 * it is not quite JSON.
 *
 * `null` rather than a throw when the name is absent: `window.CFG` is a signpost
 * a page may or may not carry, and the caller is the one that knows whether its
 * absence is a miss or a fault.
 */
function parseInlineObject(html, name) {
  const match =
    html.match(new RegExp(`window\\.${name}\\s*=\\s*({[\\s\\S]*?});?\\s*</script>`, 'i')) ??
    html.match(new RegExp(`window\\.${name}\\s*=\\s*({[\\s\\S]*?});`, 'i'));
  if (!match) return null;

  const source = match[1].replace(/\\u0026/g, '&');
  try {
    return JSON.parse(source);
  } catch {
    // eslint-disable-next-line no-new-func -- the page's own object literal, and
    // only ever reached when it is not JSON; the same fallback the other
    // providers use for a config written by hand.
    return new Function(`return ${source}`)();
  }
}

/**
 * The sealed stream URLs, opened by the module the API names.
 *
 * The plaintext is read out of the module's linear memory at an offset of twelve
 * bytes — a header the exporter writes before the addresses — and every address
 * is one line. Nothing is validated here beyond splitting: an address that is
 * not one is dropped by the proxy's own URL check when it is fetched.
 */
async function unsealStreamUrls(vs, sealed, signal) {
  const response = await fetchStep(vs.wasm_url, { credentials: 'omit' }, signal);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  const instance = await WebAssembly.instantiate(module, {});
  const ex = instance.exports;

  const encrypted = base64Bytes(sealed);
  const pointer = ex.alloc(encrypted.length);
  new Uint8Array(ex.memory.buffer, pointer, encrypted.length).set(encrypted);

  const length = ex.decrypt(pointer, encrypted.length);
  const plaintext = new TextDecoder().decode(
    new Uint8Array(ex.memory.buffer, pointer + 12, length),
  );

  return plaintext.split('\n').filter(Boolean);
}

/**
 * The stream address the API hands back, and the player page it belongs to.
 *
 * @returns {Promise<{streamUrls: string[], playerFullUrl: string, origin: string}>}
 *          An empty `streamUrls` is an ordinary miss — a title this source does
 *          not carry — and is left to the caller to turn into `null`. Anything
 *          else is a fault and is thrown.
 */
export async function inspectVidplay({
  tmdbId,
  mediaType = 'movie',
  season = null,
  episode = null,
  signal,
} = {}) {
  if (!tmdbId) throw new Error('tmdbId is required for Vidplay');
  if (mediaType !== 'movie' && mediaType !== 'tv') throw new Error('Unsupported media type.');
  if (mediaType === 'tv' && (!Number.isInteger(Number(season)) || !Number.isInteger(Number(episode)))) {
    throw new Error('TV playback requires a season and an episode.');
  }

  const embedPath = mediaType === 'tv' ? `${tmdbId}/${Number(season)}-${Number(episode)}` : `${tmdbId}`;

  const embed = await fetchStep(`${EMBED_BASE_URL}/embed/${embedPath}`, { headers: EMBED_HEADERS }, signal);
  const embedHtml = await embed.text();

  const apiMatch = embedHtml.match(/data-api="([^"]+)"/);
  if (!apiMatch) throw new Error('The embed page named no source endpoint.');
  const sourceUrl = new URL(apiMatch[1].replace(/&amp;/g, '&'), EMBED_BASE_URL).href;

  const source = await fetchStep(
    sourceUrl,
    { headers: { ...EMBED_HEADERS, 'X-Requested-With': 'XMLHttpRequest' } },
    signal,
  );
  const { src: stellarUrl } = await source.json();
  if (!stellarUrl) throw new Error('The source endpoint named no host page.');

  const stellarOrigin = new URL(stellarUrl).origin;
  const stellar = await fetchStep(
    stellarUrl,
    { headers: { ...EMBED_HEADERS, Referer: `${EMBED_BASE_URL}/`, Origin: EMBED_BASE_URL } },
    signal,
  );
  let playerHtml = await stellar.text();
  let playerFullUrl = stellarUrl;

  // The stellar page may only be a signpost: a `window.CFG` naming the player it
  // would have shown, which has to be fetched in its turn. When it is not there
  // the page is the player itself, which is what the URL already says.
  const cfg = parseInlineObject(playerHtml, 'CFG');
  if (cfg?.playerUrl) {
    playerFullUrl = new URL(cfg.playerUrl, stellarUrl).href;
    const player = await fetchStep(
      playerFullUrl,
      { headers: { ...EMBED_HEADERS, Referer: stellarUrl, Origin: stellarOrigin } },
      signal,
    );
    playerHtml = await player.text();
  }

  const config = parseInlineObject(playerHtml, 'CONFIG');
  if (!config) throw new Error('The player page named no configuration.');
  const baseApi = (config.streamBase || config.metaApi || config.api)?.split('&season=')[0].split('&episode=')[0];
  if (!baseApi) throw new Error('The player page named no stream API.');

  const params = mediaType === 'tv' ? `?type=tv&tmdb=${tmdbId}` : `?type=movie&tmdb=${tmdbId}`;
  let streamApiUrl = /type=(tv|movie)/.test(baseApi) ? baseApi : `${baseApi}${params}`;
  if (mediaType === 'tv') streamApiUrl += `&season=${Number(season)}&episode=${Number(episode)}`;
  streamApiUrl += `&stream_urls&api_token=${encodeURIComponent(config.apiToken)}`;

  const origin = new URL(playerFullUrl).origin;
  const streams = await fetchStep(
    streamApiUrl,
    {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Referer: playerFullUrl,
        Origin: origin,
        'User-Agent': EMBED_HEADERS['User-Agent'],
      },
    },
    signal,
  );
  const streamData = await streams.json();

  let streamUrls = [];
  if (streamData.data && typeof streamData.data.stream_urls === 'string' && streamData.vs) {
    streamUrls = await unsealStreamUrls(streamData.vs, streamData.data.stream_urls, signal);
  } else if (Array.isArray(streamData.data?.stream_urls)) {
    streamUrls = streamData.data.stream_urls;
  } else if (Array.isArray(streamData.stream_urls)) {
    streamUrls = streamData.stream_urls;
  }

  return {
    streamUrls: streamUrls.filter((url) => typeof url === 'string' && /^https:\/\//.test(url)),
    playerFullUrl,
    origin,
  };
}
