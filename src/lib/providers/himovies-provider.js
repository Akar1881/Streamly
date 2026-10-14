/**
 * ============================================================================
 *  MAIN — the provider
 * ============================================================================
 *  The browser half of the lookup: ask our own route for the player config, then
 *  hand the stream to the player through the proxy, because an address minted on
 *  our server has to be fetched from our server. The account of that is in
 *  `src/app/api/himovies/proxy/route.js`.
 *
 *  This is the site's main source — see `player.main` in `config/site.js` — and
 *  the reason it is worth prefering is not the picture but the subtitles: what
 *  this provider returns includes the subtitle files shipped with the copy being
 *  watched, so a translation made from one of them is timed to the film on
 *  screen rather than to some other release of it.
 * ============================================================================
 */

/**
 * What viewers are told this source is called.
 *
 * A codename, like every provider here — see the contract in
 * `src/lib/providers/index.js`. Alpha, Neon, Onyx and Vega are taken.
 */
const CODENAME = 'Main';

/**
 * The stream, pointed through our proxy.
 *
 * Relative, and deliberately so: this runs in the browser and has to resolve
 * against whatever origin the page was served from. Nothing else rides on the
 * query string — the signature is already on the URL — which keeps this short
 * on a playlist whose children are rewritten for every segment of a film.
 */
function proxiedStreamUrl(url) {
  return `/api/himovies/proxy?${new URLSearchParams({ url })}`;
}

export default {
  id: 'himovies',
  label: CODENAME,

  async resolve({ mediaType, tmdbId, imdbId, season, episode, signal }) {
    const response = await fetch('/api/himovies/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType, tmdbId, imdbId, season, episode }),
      signal,
    });

    if (!response.ok) throw new Error(`Main resolution failed (${response.status}).`);

    const playback = await response.json();
    if (typeof playback.streamUrl !== 'string' || !playback.streamUrl) return null;

    return {
      sources: [
        {
          src: proxiedStreamUrl(playback.streamUrl),
          type: 'application/x-mpegURL',
          label: CODENAME,
        },
      ],

      /**
       * The subtitles the provider shipped with this copy, handed to the player
       * exactly as they came.
       *
       * Not proxied, unlike the stream. These live on a different host from the
       * video, one that sends `Access-Control-Allow-Origin: *`, and their URLs
       * carry no signature and no address — so the browser can fetch them
       * directly, and the site's own pipeline reaches them for the translation
       * through `fetchProviderSubtitle`. Neither needs the proxy, which exists
       * for a reason these files do not share.
       *
       * No `lang` and no `default`, also on purpose. The labels are free text —
       * `English`, `German - Forced [Ger] 2` — and free text is exactly what
       * `pickSourceTrack` and `dedupeTracks` in `src/lib/player/tracks.js` match
       * on; inventing codes for them would be guessing at a fact the file itself
       * states. And the provider marking its English as default is not worth
       * repeating: `DEFAULT_TRACK_LABELS` in `VideoPlayer.js` already reaches
       * for English first, and claiming it here as well would only be a second
       * say in a decision that already has one.
       */
      tracks: (playback.tracks ?? [])
        .filter((track) => typeof track?.file === 'string' && track.file)
        .map(({ file, label }) => ({ src: file, label: label ?? 'Subtitles' })),

      poster: playback.poster ?? undefined,
    };
  },
};
