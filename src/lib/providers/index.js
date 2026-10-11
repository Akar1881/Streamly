/**
 * ============================================================================
 *  PLAYBACK PROVIDERS
 * ============================================================================
 * g
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
 *  rather than the name of the service behind it — `Alpha`, `Neon`, `Delta`.
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
 *
 *             `width` and `height` are optional, and are for a provider that
 *             knows its picture without being asked — one serving progressive
 *             MP4, say, where there is no manifest to read a resolution out of.
 *             They are consulted only when the manifest probe came back empty,
 *             so they can never override a measured stream; what they can do is
 *             let a declared resolution win a comparison it should have won and
 *             would otherwise have lost as zero. A provider that declares a
 *             resolution it does not have is therefore a way to be wrong here,
 *             and the only defence is that these are ours to write.
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
import vidnest from './vidnest-provider';
import vidplay from './vidplay-provider';
import { measureStream } from './quality';

/**
 * Every implemented provider, keyed by its `id`.
 *
 * Empty until you add one — see the example at the top of this file. An id
 * listed in `config/site.js` with no module here is skipped rather than
 * crashing the watch page, so a typo costs a switcher entry, not the site.
 */
const PROVIDERS = { videasy, vidnest, vidplay };

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

/**
 * How long any one provider gets to answer before it is out of the running.
 *
 * The list order in `config/site.js` decides ties, not the outcome, so a provider
 * that never answers would hold up the choice for as long as it felt like — and
 * they do not all defend themselves. Vidnest gives each of the ten servers it
 * asks eight seconds, which is longer than a source is worth waiting for before
 * anyone knows whether it has this title; Videasy has no deadline at all and
 * passes the signal straight through to a chain of fetches that will sit there
 * until something else cancels it. So the deadline is ours, and it is the only
 * thing standing between a hung source and a watch page that never starts.
 *
 * Five seconds is chosen against the slow one, which fans out to ten hosts and
 * can legitimately spend a few seconds doing it. Anything that has not answered
 * by then is not a source worth defaulting to, whatever it eventually says.
 */
const COMPARE_TIMEOUT_MS = 5_000;

/**
 * A source's resolution, when the provider stated it instead of a manifest.
 *
 * Only a provider serving progressive files needs this. With nothing to probe,
 * `measureStream` answers null for every one of its streams — correctly, since
 * it measures HLS and says so — and a null measurement compares as zero against
 * everything, so such a provider would lose to any HLS stream at all, including
 * ones it is better than.
 *
 * The shape is deliberately the one `measureStream` returns, label included, so
 * that a stated resolution and a measured one are the same thing to everything
 * downstream: the switcher shows the label beside the provider's codename either
 * way, and nothing has to know which of the two it was given.
 *
 * Anything that is not two positive numbers is not a statement, so it is
 * `null` — the same "we could not tell" the probe gives, rather than a default
 * that would quietly rank a provider on a number nobody supplied.
 */
function declaredQuality(source) {
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return { width, height, label: `${height}p` };
}

/**
 * Asks every configured provider, and says which of them answered best.
 *
 * This is the difference between "the first source in the config file" and "the
 * best source for this title". It is not free, and the cost is the whole reason
 * this is one function with a comment rather than a line in the caller: every
 * provider is asked on every title, where before only one was, so a watch page
 * now costs the sum of everyone's lookups upstream even though it plays exactly
 * one of them. What it buys is that the film starts on the best copy available
 * rather than on whichever service happened to be listed first — a film that
 * came back as 2160p from one provider and 800p from another plays at 2160p
 * without the viewer having to know there was a choice.
 *
 * They are asked concurrently, so the wait is the slowest provider rather than
 * the total. Everything that came back is returned, not just the winner: the
 * source menu needs to know what the others had, both to mark the ones that
 * came up empty and so that switching to one costs nothing at the moment it is
 * asked for.
 *
 * Only the first source of each provider is measured, because only the first is
 * ever attached — measuring the rest would be work spent on something no viewer
 * can reach. A provider that states its resolution rather than having one read
 * from a manifest is read from that same first source, for that same reason.
 *
 * @returns {Promise<{chosen: object|null, answers: object[]}>}
 *          `chosen` is one answer, or null when nobody had this title.
 */
export async function resolveBestPlayback({
  mediaType,
  tmdbId,
  imdbId,
  season,
  episode,
  signal,
  timeoutMs = COMPARE_TIMEOUT_MS,
}) {
  /** One provider, asked under our deadline as well as the caller's. */
  async function ask(provider) {
    const controller = new AbortController();
    const relay = () => controller.abort();
    signal?.addEventListener('abort', relay, { once: true });

    let gaveUp = false;
    const deadline = setTimeout(() => {
      gaveUp = true;
      controller.abort();
    }, timeoutMs);

    const answer = { providerId: provider.id, label: provider.label ?? fallbackLabel(provider.id) };

    try {
      const playback = await resolvePlayback({
        providerId: provider.id,
        mediaType,
        tmdbId,
        imdbId,
        season,
        episode,
        signal: controller.signal,
      });

      const first = playback?.sources?.[0];
      return {
        ...answer,
        playback,
        quality:
          (first?.src ? await measureStream(first.src, { signal: controller.signal }) : null) ??
          declaredQuality(first),
        threw: false,
        gaveUp,
      };
    } catch (cause) {
      // A provider that threw is a fault, which is a different sentence to the
      // viewer than "this title is not here" — but an abort is neither, it is
      // this function's own doing, and is reported as nothing at all.
      return {
        ...answer,
        playback: null,
        quality: null,
        threw: !gaveUp && cause?.name !== 'AbortError',
        gaveUp,
      };
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', relay);
    }
  }

  const answers = await Promise.all(listProviders().map(ask));
  const playable = answers.filter((answer) => answer.playback);

  // Ties keep the earlier answer, because `listProviders` is in config order and
  // a reduce that only replaces on strictly greater preserves it. Two providers
  // offering the same resolution is the common case, and there the config file
  // is the only preference anyone has expressed.
  const chosen = playable.reduce(
    (leader, answer) => ((answer.quality?.width ?? 0) > (leader.quality?.width ?? 0) ? answer : leader),
    playable[0],
  );

  return { chosen: chosen ?? null, answers };
}
