import { inspectVidplay } from '@/lib/providers/vidplay';

export const runtime = 'nodejs';

/**
 * ============================================================================
 *  VIDPLAY RESOLUTION
 * ============================================================================
 *  `POST { mediaType, tmdbId, season?, episode? }` → `{ streamUrls,
 *  playerFullUrl, origin }`. The URLs are the real ones, unsealed; the provider
 *  turns each into a proxy URL before the player ever sees it, and the two
 *  addresses are the headers that proxy has to send.
 *
 *  Node.js runtime, and both halves of the lookup need it: the chain fetches
 *  with a `Referer` and an `Origin`, and it compiles and runs a WebAssembly
 *  module, which the edge runtime will not instantiate from a fetched buffer.
 *
 *  Nothing is cached. The addresses name hosts the source rotates per title and
 *  a token that is minted per request by the proxy, so a reply is good for the
 *  page that asked and no longer.
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
    const { streamUrls, playerFullUrl, origin } = await inspectVidplay({
      tmdbId,
      mediaType,
      season: Number(season),
      episode: Number(episode),
      signal: request.signal,
    });

    return Response.json(
      { streamUrls, playerFullUrl, origin },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // A viewer navigating away aborts the lookup. That is not a fault and there
    // is nobody left to tell about it — the same distinction the other routes
    // make, and without it every navigation would leave a line in the log.
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });

    if (error?.code === 'VIDPLAY_TIMEOUT') {
      console.error('Vidplay resolution timed out.');
      return Response.json({ error: 'Vidplay took too long to respond.' }, { status: 504 });
    }

    console.error('Vidplay resolution failed:', error);
    return Response.json({ error: 'Vidplay could not resolve this title.' }, { status: 502 });
  }
}
