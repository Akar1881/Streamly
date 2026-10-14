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
 * The headers the discovery fetch was missing.
 *
 * The scraper sends a User-Agent and a `Referer` naming the mirror these embeds
 * were found on, and that pair is evidently enough from a home connection — it
 * is what has been resolving titles here all along. It is not enough from a
 * datacenter one. This host sits behind Cloudflare, and the challenge it serves
 * a cloud address is scored on the headers a browser would have sent at least
 * as much as on the address itself; a request carrying two of them reads as a
 * script.
 *
 * Below is the rest of that set: `Accept`, the language, the `Sec-Fetch-*`
 * triple and the client hints, valued as Chrome sends them for a cross-site
 * iframe. They are laid *over* the scraper's own rather than replacing them, so
 * the User-Agent and `Referer` that make this work locally are untouched.
 *
 * `Accept-Encoding` is deliberately not here. It is the one header undici sets
 * for itself and will not let anyone else set, and what it negotiates is what
 * it can decode.
 *
 * The version strings are the browser's, not ours, so they will go stale. That
 * is true of the scraper's User-Agent too and it has not mattered: the challenge
 * is asking whether a browser sent this, not which build.
 */
const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://himovies.watch',
  'Sec-Fetch-Dest': 'iframe',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

/**
 * What the discovery host said, logged, for the one case the answer cannot
 * carry it.
 *
 * `getMediaSources` flattens every way a lookup can come back empty — a status
 * that is not OK, a page with no player config in it, a fetch that never
 * connected — into a single `null`. That is the right answer for the caller,
 * which does the same thing in all three cases, and a useless one for us:
 * production has been reaching this branch on titles that resolve here, and no
 * amount of reading the code says whether that is a Cloudflare refusal or a
 * genuine miss.
 *
 * So on a miss, and only on a miss, the request is made once more — by this
 * file, purely to log the status and where the redirect landed. It cannot
 * change the answer, because the miss is already decided by the time it runs,
 * and every way the probe itself can fail is swallowed; the worst it does is
 * put a line in the function log.
 *
 * The URL is built from `scraper.baseUrl` so that changing the mirror moves
 * this with it. The two shapes are the ones the header above describes.
 *
 * This is scaffolding around an open fault. Delete it once Main's misses have
 * an explanation.
 */
async function reportMiss(scraper, title) {
  const where =
    title.mediaType === 'movie'
      ? `${scraper.baseUrl}/vmf/${title.imdbId}/${title.tmdbId}/`
      : `${scraper.baseUrl}/vms/${title.tmdbId}/${title.season}/${title.episode}/`;

  try {
    const probe = await fetch(where, {
      headers: scraper.headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(5_000),
    });
    console.warn(`[himovies] miss: upstream answered ${probe.status} at ${probe.url}`);
  } catch (cause) {
    console.warn(`[himovies] miss: upstream unreachable — ${cause?.message ?? cause}`);
  }
}

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

  // The scraper is used as it is written; the only thing changed about it is
  // the set of headers on the wire, which is this route's business rather than
  // its own. `headers` is a fresh object per instance, so this reaches nothing
  // but the instance about to be used. See BROWSER_HEADERS.
  const scraper = new MovieStreamScraper();
  Object.assign(scraper.headers, BROWSER_HEADERS);

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
      await reportMiss(scraper, title);

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
