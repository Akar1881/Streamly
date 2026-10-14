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
 *
 *  ---------------------------------------------------------------------------
 *  The one part of the lookup that has to happen here
 *  ---------------------------------------------------------------------------
 *
 *  Getting from a title to a stream is a hop through a host that redirects to
 *  the embed page carrying the player config. Our server cannot make that hop
 *  in production — the host refuses its address outright — and this browser can,
 *  because it is the viewer's and that host has no quarrel with it.
 *
 *  So when the route comes back empty it also says where the redirect lives, and
 *  this module follows it and asks again with the address it landed on. The page
 *  itself is never read here: the route fetches and parses it, which it is able
 *  to do, which keeps every part of the scraping scheme on the server side of
 *  the seam and this module concerned only with playback.
 *
 *  Running here by default is also what keeps the fallback invisible. There is
 *  no second attempt on a title that resolves normally, and none on a title
 *  nobody carries beyond one extra request.
 *
 *  What it costs is the one thing the codename was for. `label` says `Main`, and
 *  the rule in `src/lib/providers/index.js` is that a viewer never learns the
 *  service behind it — but a request made from the viewer's own browser is one
 *  the viewer can watch, and the address it goes to is in their network tab for
 *  as long as the page is open. The name stays out of the interface, which is
 *  what that rule is really protecting; it does not stay out of their devtools,
 *  and there is no version of this that keeps both.
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
 * Where the discovery host sends a browser.
 *
 * This is the half of the lookup described in the header, and it is worth being
 * clear about what is *not* done here: the response is not read, not parsed and
 * not kept. All that is wanted is the address the redirect settled on, which the
 * browser knows as soon as the response arrives.
 *
 * `no-referrer` because the request that is known to work from a home
 * connection carries none, and `omit` because the viewer has no business
 * sending this host a session it never gave us.
 *
 * Answers null when there is nothing to report: the request failed, or the URL
 * came back unchanged — meaning the host did not redirect, so asking the route
 * again would only repeat an attempt that has already been made.
 */
async function followRedirect(url, signal) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      signal,
    });

    // Read and dropped. It is a third party's markup on a phone connection and
    // nothing in it is used, and `response.url` is already settled by the time
    // the headers are.
    await response.body?.cancel();

    return response.url && response.url !== url ? response.url : null;
  } catch (cause) {
    // Swallowed, but not silently. Every way this can go wrong ends in the same
    // `null` as a hop that simply found nothing, and the consequence is the same
    // either way — the page falls back and the viewer is told this source does
    // not have the title. That leaves one line of trace and this is it: a CORS
    // refusal, a dead connection and a cancelled request are indistinguishable
    // from a miss without it, and they have three different fixes.
    console.warn(`[himovies] the redirect from ${url} went nowhere:`, cause);
    return null;
  }
}

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
    /** One attempt, with or without the address a browser resolved for us. */
    async function ask(extra) {
      const response = await fetch('/api/himovies/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaType, tmdbId, imdbId, season, episode, ...extra }),
        signal,
      });

      if (!response.ok) throw new Error(`Main resolution failed (${response.status}).`);
      return response.json();
    }

    let playback = await ask();

    /**
     * The second attempt, and only ever the second.
     *
     * A miss is not proof that the title is absent: it is also what this says
     * when the route could not reach the discovery host at all, which in
     * production is every time. The route tells the two apart for us by naming
     * the address — it hands one back on every miss, so the test is simply
     * whether the redirect lands somewhere new.
     */
    if (!playback.streamUrl && playback.discoveryUrl) {
      const landed = await followRedirect(playback.discoveryUrl, signal);
      if (landed) playback = await ask({ embedUrl: landed });
    }

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
