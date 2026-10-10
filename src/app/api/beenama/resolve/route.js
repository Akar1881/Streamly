import { inspectBeenama } from '@/lib/providers/beenama';

export const runtime = 'nodejs';

/**
 * ============================================================================
 *  BEENAMA RESOLUTION
 * ============================================================================
 *  The browser asks, the lookup talks to the API, the player gets URLs. The
 *  reason it cannot be done from the page is in `src/lib/providers/beenama.js`:
 *  the request needs headers a browser is not allowed to set.
 *
 *  `POST { mediaType, tmdbId, season?, episode? }` → `{ sources: [...] }`, each
 *  source `{ url, type, width, height, codec, quality }`. Nothing is cached,
 *  which matters more here than elsewhere: the media URLs are signed and the
 *  reply states its own `TTL` as an hour, so a stored URL is a URL that stops
 *  working.
 *
 *  Node.js runtime — the lookup makes an outbound request with headers that
 *  cannot be set from an edge runtime's `fetch`.
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
    const { streams } = await inspectBeenama({
      tmdbId,
      mediaType,
      season: Number(season),
      episode: Number(episode),
      signal: request.signal,
    });

    // Nothing is stripped on the way out, unlike the other providers' routes.
    // The name this source answers to upstream never enters a stream — the
    // lookup builds each one out of a URL, a type and three numbers — so there
    // is no codename to enforce here rather than a rule being skipped.
    return Response.json({ sources: streams }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // A viewer closing the tab aborts the lookup. That is not a fault and there
    // is nobody left to tell about it — the same distinction the proxy routes
    // make, and without it every navigation away would leave a line in the log.
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });

    console.error('Beenama resolution failed:', error);
    return Response.json({ error: 'Beenama could not resolve this title.' }, { status: 502 });
  }
}
