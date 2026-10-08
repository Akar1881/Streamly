import { inspectVideasy } from '@/lib/providers/videasy';

export const runtime = 'nodejs';

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
    const { streamUrls, playerFullUrl, origin } = await inspectVideasy(tmdbId, {
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
    console.error('Videasy resolution failed:', error);
    return Response.json({ error: 'Videasy could not resolve this title.' }, { status: 502 });
  }
}