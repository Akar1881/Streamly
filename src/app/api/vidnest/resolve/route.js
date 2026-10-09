import { inspectVidnest } from '@/lib/providers/vidnest';

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
    const { streams, subtitles } = await inspectVidnest({
      tmdbId,
      mediaType,
      season: Number(season),
      episode: Number(episode),
      signal: request.signal,
    });

    // The upstream server each stream came from is dropped here rather than in
    // the client: it is a real service name, and the codename rule in
    // `src/lib/providers/index.js` says those do not reach a viewer. Nothing
    // downstream wants it — the source menu numbers these by position — and a
    // name that never leaves the server cannot arrive in a browser by mistake.
    // `url` and `type` are the two the provider reads; `quality` is kept because
    // it is the only thing that describes the picture when a stream carries no
    // resolution of its own.
    const playable = streams.map(({ url, type, quality }) => ({ url, type, quality }));

    return Response.json(
      { streams: playable, subtitles },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Vidnest resolution failed:', error);
    return Response.json({ error: 'Vidnest could not resolve this title.' }, { status: 502 });
  }
}
