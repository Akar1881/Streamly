import { inspectVidrock } from '@/lib/providers/vidrock';

export const runtime = 'nodejs';

/**
 * ============================================================================
 *  VIDROCK RESOLUTION
 * ============================================================================
 *  `POST { mediaType, tmdbId, season?, episode? }` → `{ streams: [...] }`, each
 *  stream `{ url, type }`. The URL is the real one, unsealed; the provider turns
 *  it into a proxy URL before the player ever sees it.
 *
 *  All that comes back is Atlas. The other four servers the API names are not
 *  withheld here, they are never read — the account of why is in
 *  `src/lib/providers/vidrock.js`.
 *
 *  Nothing is cached. The addresses are sealed rather than signed, so they do
 *  not carry an expiry of their own, but they name hosts vidrock rotates and a
 *  segment path it can retire at will; a resolve is one request and happens once
 *  per watch page.
 *
 *  Node.js runtime — the lookup unseals with `crypto.subtle`, which the edge
 *  runtime also has, but it also fetches with headers the edge runtime's `fetch`
 *  cannot be given.
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
    const { streams } = await inspectVidrock({
      tmdbId,
      mediaType,
      season: Number(season),
      episode: Number(episode),
      signal: request.signal,
    });

    return Response.json({ streams }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // A viewer navigating away aborts the lookup. That is not a fault and there
    // is nobody left to tell about it — the same distinction the other routes
    // make, and without it every navigation away would leave a line in the log.
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });

    console.error('Vidrock resolution failed:', error);
    return Response.json({ error: 'Vidrock could not resolve this title.' }, { status: 502 });
  }
}
