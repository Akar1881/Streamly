/**
 * ============================================================================
 *  PLAYBACK PROVIDERS
 * ============================================================================
 *
 *  A provider answers one question: "the visitor asked for this title — what
 *  should the player play?" It is handed the identifiers the app already has
 *  and returns the URLs `VideoPlayer` takes. It is the only part of the app
 *  that knows where media comes from; nothing else does, and nothing else has
 *  to change when a provider is added, swapped or removed.
 *
 *  ---------------------------------------------------------------------------
 *  Adding one
 *  ---------------------------------------------------------------------------
 *
 *    1. Write a module in this directory:
 *
 *         export default {
 *           id: 'example',              // matches the entry in config/site.js
 *           label: 'Neon',              // what the switcher calls it — a codename
 *
 *           async resolve({ mediaType, tmdbId, imdbId, season, episode, signal }) {
 *             const found = await lookItUp(...);        // sync is fine too
 *             if (!found) return null;                  // nothing for this title
 *
 *             return {
 *               sources: [{ src: found.hls, type: 'application/x-mpegURL' }],
 *               tracks: [{ src: found.subtitles, label: 'English', lang: 'en' }],
 *               poster: found.poster,                   // optional
 *             };
 *           },
 *         };
 *
 *    2. Import it below and add it to `PROVIDERS`.
 *    3. Add its `id` to `player.providers` in `config/site.js`.
 *
 *  That is the whole integration. `PlayerStage` asks for a playback and hands
 *  the result straight to the player; there is no third step.
 *
 *  ---------------------------------------------------------------------------
 *  `label` is a codename, never the service's real name
 *  ---------------------------------------------------------------------------
 *
 *  Every name a viewer can read comes from `label`, and it is a word we chose
 *  rather than the name of the service behind it — `Alpha`, `Neon`, `Gamma`.
 *  That is a rule for this directory, not a per-provider decision: source
 *  labels, the provider switcher and anything added later all inherit it from
 *  here, so a new provider written to this contract is pseudonymous by default
 *  and nobody has to remember to anonymise it afterwards.
 *
 *  The real name belongs in `id`, which is ours — it appears in
 *  `config/site.js`, in logs, and in the provider module's filename, and none
 *  of those are put in front of a viewer. Error strings a provider throws are
 *  the same: `PlayerStage` catches them and shows the generic copy from
 *  `player.unavailable`, so they are read by us and not by a viewer.
 *
 *  ---------------------------------------------------------------------------
 *  What `resolve` is given, and what it returns
 *  ---------------------------------------------------------------------------
 *
 *  Given:
 *    mediaType  'movie' | 'tv'
 *    tmdbId     the TMDB id — always present
 *    imdbId     movies only; TMDB does not return one for shows
 *    season     episodes only
 *    episode    episodes only
 *    signal     an AbortSignal, aborted when the page moves on. Pass it to any
 *               `fetch` you do so a provider that is slow to answer a title the
 *               visitor has already left does not keep running.
 *
 *  Returned:
 *    sources  required, at least one. `{ src, type?, label?, headers? }`, played
 *             in order. `type` is a MIME type; leave it out and the player picks
 *             the engine from the URL — `application/x-mpegURL` for an .m3u8,
 *             `video/mp4` for anything else. `headers` are sent with the
 *             manifest and every segment, for a host that requires them; the
 *             browser will only let a page set names that are not on its
 *             forbidden list, so `Authorization` and custom `X-…` headers work
 *             and `Referer` / `Origin` / `User-Agent` are dropped no matter
 *             what is passed. See `headerConfig` in `src/lib/player/source.js`.
 *    tracks   optional subtitle files for the captions menu.
 *             `{ src, label, lang?, default? }`. `default: true` is the one the
 *             player switches on by itself.
 *    poster   optional image URL, overriding the page's own artwork.
 *
 *  Returning `null` means "nothing here": the watch page shows its no-source
 *  panel, and the viewer can try another configured provider from the
 *  switcher. Use it for an ordinary miss — a title this provider does not
 *  carry is not an error. **Throw** only for a genuine failure worth putting
 *  in front of the viewer.
 * ============================================================================
 */

import site from '@config/site';
import videasy from './videasy-provider';

/**
 * Every implemented provider, keyed by its `id`.
 *
 * Empty until you add one — see the example at the top of this file. An id
 * listed in `config/site.js` with no module here is skipped rather than
 * crashing the watch page, so a typo costs a switcher entry, not the site.
 */
const PROVIDERS = { videasy };

/**
 * What to call a provider that has no `label`.
 *
 * Deliberately *not* its `id`. The id is the service's real name — that is the
 * point of the split — so falling back to it would put the one word this whole
 * arrangement exists to hide in front of a viewer, and it would do it on the
 * day a provider author forgot a field, which is the day nobody is looking.
 *
 * A provider missing its `label` is a mistake, so it should look like one: the
 * warning names the module, and every unlabelled provider reading "Source" in
 * the switcher is wrong in a way that gets noticed rather than plausible
 * enough to ship.
 */
function fallbackLabel(id) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[providers] "${id}" has no label. Give it a codename — see the comment at the top of src/lib/providers/index.js.`,
    );
  }
  return 'Source';
}

/** Every configured provider that actually exists, in config order. */
export function listProviders() {
  return site.player.providers
    .map((id) => PROVIDERS[id])
    .filter(Boolean)
    .map(({ id, label }) => ({ id, label: label ?? fallbackLabel(id) }));
}

/** The module behind an id, or undefined if nothing is registered for it. */
export function getProvider(id) {
  return PROVIDERS[id];
}

/**
 * Asks one provider for what to play.
 *
 * @param {object} request
 * @param {string}  request.providerId
 * @param {'movie'|'tv'} request.mediaType
 * @param {number|string} request.tmdbId
 * @param {string}  [request.imdbId]
 * @param {number}  [request.season]
 * @param {number}  [request.episode]
 * @param {AbortSignal} [request.signal]
 * @returns {Promise<{providerId: string, label: string, sources: Array, tracks: Array, poster: string|null}|null>}
 *          `null` when the provider is unknown, has nothing, or came back with
 *          an empty `sources` list — all three mean the same thing to the
 *          caller, so they are flattened into one answer here rather than
 *          leaving every caller to check for themselves.
 */
export async function resolvePlayback({
  providerId,
  mediaType,
  tmdbId,
  imdbId,
  season,
  episode,
  signal,
}) {
  const provider = PROVIDERS[providerId];
  if (!provider?.resolve) return null;

  const playback = await provider.resolve({
    mediaType,
    tmdbId,
    imdbId,
    season,
    episode,
    signal,
  });

  if (!playback?.sources?.length) return null;

  return {
    providerId,
    label: provider.label ?? fallbackLabel(providerId),
    sources: playback.sources,
    tracks: playback.tracks ?? [],
    poster: playback.poster ?? null,
  };
}
