/**
 * ============================================================================
 *  MAIN — resolution
 * ============================================================================
 *  `POST { mediaType, tmdbId, imdbId?, season?, episode? }` → the player config
 *  for that title: `{ streamUrl, poster, duration, tracks }`.
 *
 *  Server-side because it has to be. The lookup is a scrape of a page on someone
 *  else's site — cross-origin, and not an API anyone agreed to — so a browser
 *  could not read the answer even if it were allowed to ask.
 *
 *  ---------------------------------------------------------------------------
 *  The two URL shapes take different arguments
 *  ---------------------------------------------------------------------------
 *
 *  A film is addressed by `imdbId` *and* `tmdbId` together; an episode by
 *  `tmdbId` and its season and episode numbers. So a movie request without an
 *  `imdbId` is not a malformed request, it is a title this route cannot look up
 *  — and it is refused here rather than sent upstream as a URL that is certain
 *  to miss. Movies always carry one; see `src/lib/tmdb/movies.js`.
 *
 *  ---------------------------------------------------------------------------
 *  A miss is not a fault
 *  ---------------------------------------------------------------------------
 *
 *  A title this service does not carry is answered `{ streamUrl: null }` with a
 *  200, the way the Vidnest route answers `{ streams: [] }`. The provider turns
 *  that into `null` and the page falls back to another source, which is the
 *  ordinary outcome for a title nobody has. The 502 below is for a lookup that
 *  actually broke — the scraper only throws when the fetch itself failed.
 *
 *  Nothing here is cached. The stream address is signed against the requesting
 *  address and expires within hours, so a cached one is worse than none.
 * ============================================================================
 */

import { MovieStreamScraper } from '@/lib/providers/himovies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** The scraped tracks that are subtitles. The rest are thumbnails. */
const CAPTIONS = 'captions';

/**
 * Reads a title out of a request, or explains why it cannot.
 *
 * `imdbId` is taken as the `tt…` string it is, not coerced to a number — it is
 * not one, and `Number('tt0111161')` is `NaN`, which is exactly the kind of
 * quiet falsification that ends up in a URL.
 */
function readTitle(input) {
  const mediaType = input?.mediaType === 'tv' ? 'tv' : input?.mediaType === 'movie' ? 'movie' : null;
  const tmdbId = String(input?.tmdbId ?? '');

  if (!mediaType || !/^\d+$/.test(tmdbId)) {
    return { error: 'mediaType must be "movie" or "tv", and tmdbId a positive integer' };
  }

  if (mediaType === 'movie') {
    const imdbId = String(input?.imdbId ?? '');
    if (!/^tt\d+$/.test(imdbId)) {
      return { error: 'A movie needs an imdbId of the form "tt1234567"' };
    }

    return { title: { mediaType, tmdbId, imdbId } };
  }

  const season = Number(input?.season);
  const episode = Number(input?.episode);

  if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode <= 0) {
    return { error: 'A TV episode needs integer season and episode numbers' };
  }

  return { title: { mediaType, tmdbId, season, episode } };
}

export async function POST(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400, headers: NO_STORE });
  }

  const { title, error } = readTitle(input);
  if (error) return Response.json({ error }, { status: 400, headers: NO_STORE });

  const scraper = new MovieStreamScraper();

  try {
    // A film is addressed by its `imdbId` and `tmdbId` together, an episode by
    // `tmdbId` and its season and episode numbers — see the header.
    const found =
      title.mediaType === 'movie'
        ? await scraper.getMediaSources('movie', title.imdbId, title.tmdbId)
        : await scraper.getMediaSources('tv', title.tmdbId, title.season, title.episode);

    // The scraper answers `null` for every way this can come back empty — a
    // title it does not carry, a status that is not OK, a fetch that failed —
    // so there is nothing here to tell apart. All of them mean the same thing
    // to a viewer: this source does not have it, and the page falls back.
    if (!found?.streamUrl) {
      return Response.json(
        { streamUrl: null, poster: null, duration: 0, tracks: [] },
        { headers: NO_STORE },
      );
    }

    return Response.json(
      {
        streamUrl: found.streamUrl,
        poster: found.posterImage ?? null,
        duration: found.duration ?? 0,
        // Only subtitles, and only the two fields the player wants. The page
        // also carries a `thumbnails` track whose `file` is a relative
        // `/api/v1/slides?…` path — relative to *their* origin, so it is not
        // merely useless here, it is wrong, and it must not reach a caption menu.
        tracks: found.tracks
          .filter((track) => track.kind === CAPTIONS && typeof track.file === 'string')
          .map(({ file, label }) => ({ file, label: label ?? null })),
      },
      { headers: NO_STORE },
    );
  } catch (cause) {
    console.error('Main resolution failed:', cause);
    return Response.json(
      { error: 'This title could not be resolved.' },
      { status: 502, headers: NO_STORE },
    );
  }
}
