import { inspectVidrock } from '@/lib/providers/vidrock';

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
    const { streams, subtitles } = await inspectVidrock({
      tmdbId,
      mediaType,
      season: Number(season),
      episode: Number(episode),
      signal: request.signal,
    });

    // The `server` each stream came from is dropped here rather than in the
    // client. It is a real service name — see the codename rule in
    // `src/lib/providers/index.js` — and nothing downstream needs it: the
    // switcher numbers these by position. A name that never leaves the server
    // cannot arrive in a viewer's browser by mistake.
    const playable = streams.map(({ url, type, language }) => ({ url, type, language }));

    return Response.json(
      { streams: playable, subtitles },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('VidRock resolution failed:', error);
    return Response.json({ error: 'VidRock could not resolve this title.' }, { status: 502 });
  }
}
