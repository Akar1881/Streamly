import { inspectVidnest } from '@/lib/providers/vidnest';

export const runtime = 'nodejs';

/**
 * ============================================================================
 *  VIDNEST RESOLUTION
 * ============================================================================
 *  `POST { mediaType, tmdbId, season?, episode? }` → `{ streams: [...] }`, each
 *  stream `{ url, type, headers }`. Every URL is the real one, unsealed; the
 *  provider turns each into a proxy URL before the player sees it.
 *
 *  A title nobody carries is not an error and does not arrive here as one. The
 *  lookup answers with an empty list — every server replies 502 to a title it
 *  does not have, and that is a miss rather than a fault — so this returns
 *  `{ streams: [] }` and the provider answers `null`. The 502 below is for a
 *  resolve that actually broke.
 *
 *  Nothing is cached. The addresses are sealed rather than signed, so they
 *  carry no expiry of their own, but they name hosts these servers rotate
 *  freely; a resolve is one request and happens once per watch page.
 *
 *  Node.js runtime. The lookup unseals with `crypto.subtle`, which the edge
 *  runtime also has, but it also fetches with headers the edge runtime's
 *  `fetch` cannot be given.
 * ============================================================================
 */

export async function POST(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { mediaType, tmdbId, season, episode } = input ?? {};
  if (
    !['movie', 'tv'].includes(mediaType) ||
    !/^\d+$/.test(String(tmdbId ?? '')) ||
    (mediaType === 'tv' && (!Number.isInteger(Number(season)) || !Number.isInteger(Number(episode))))
  ) {
    return Response.json({ error: 'Invalid playback request.' }, { status: 400 });
  }

  try {
    const { streams } = await inspectVidnest({
      tmdbId,
      mediaType,
      season: Number(season),
      episode: Number(episode),
      signal: request.signal,
    });

    /**
     * Which server each stream came from is dropped here rather than in the
     * client: it is a real service name, and the codename rule in
     * `src/lib/providers/index.js` says those do not reach a viewer. Nothing
     * downstream wants it — the source menu numbers these by position — and a
     * name that never leaves the server cannot arrive in a browser by mistake.
     *
     * `headers` is the exception, and it is not one really: a `Referer` and an
     * `Origin` are the CDN's own addresses, not the service behind it, and the
     * provider needs them because the hosts are no longer one fixed pair. One
     * title's playlist can want `pwcloud.animanga.fun` and the next's
     * `goodstream.cc`, so the pair travels with the stream it belongs to and
     * ends up on the proxy's query string.
     *
     * No subtitles come back with them. The links these servers offer are
     * relative paths, which are neither fetchable here nor playable in a
     * browser, and carrying them this far only put entries in the captions menu
     * that did nothing. See the account in `src/lib/providers/vidnest.js`.
     */
    const playable = streams.map(({ url, type, headers }) => ({ url, type, headers }));

    return Response.json({ streams: playable }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // A viewer navigating away aborts the lookup. That is not a fault and there
    // is nobody left to tell about it — the same distinction the other routes
    // make, and without it every navigation away would leave a line in the log.
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });

    console.error('Vidnest resolution failed:', error);
    return Response.json({ error: 'Vidnest could not resolve this title.' }, { status: 502 });
  }
}
