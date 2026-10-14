/**
 * ============================================================================
 *  SUBTITLE SOURCE — Wyzie Subs
 * ============================================================================
 *
 *  Finds an English subtitle for a title and hands back a WebVTT file ready to
 *  be torn into cues and translated.
 *
 *  Wyzie's own download links are converted to WebVTT on their server when the
 *  request asks for it (`withDownloadOptions`), which also lets us ask for
 *  `plain` — styling codes, empty lines and duplicates removed. That runs on
 *  the free tier and matters here: `{\an8}` and `<font>` markup is not text,
 *  and a translator asked to translate it produces garbage where dialogue
 *  should be.
 *
 *  Server-side only — the API key never leaves this process.
 * ============================================================================
 */

import { parseToVTT, searchSubtitles, withDownloadOptions, WyzieError } from 'wyzie-lib';
import site from '@config/site';
import { getKey } from '@/lib/settings';
import { SubtitleError } from './error';
import { stripPromoCues } from './promo';

/**
 * Wyzie's key, or null when the site is running without the feature configured.
 *
 * The viewer's own key when they have one — see `src/lib/settings.js`, which is
 * where the desktop app keeps it. Falling back to ours is what makes subtitles
 * work on a fresh install, and it is the reason the wizard frames adding a key
 * as an upgrade rather than a requirement.
 */
export function wyzieKey() {
  return getKey('WYZIE_API_KEY');
}

/** Formats worth accepting; both parse the same way on our side. */
const FORMATS = ['srt', 'vtt'];

/** Turns Wyzie's failures into ours, keeping the quota case distinguishable. */
function toSubtitleError(error, action) {
  if (error instanceof WyzieError) {
    const { status, apiMessage, body } = error;

    // 429 is the free key's daily cap; 402 is a key with nothing left on it.
    // Both mean "come back later", not "this title has no subtitle".
    if (status === 429 || status === 402) {
      return new SubtitleError(apiMessage ?? 'Subtitle service quota reached', 'limit', {
        status,
        resetAt: body?.reset_at ?? null,
      });
    }

    // A key that is missing, malformed or on hold is a configuration problem,
    // not a runtime one.
    if (status === 401 || status === 403) {
      return new SubtitleError(apiMessage ?? 'Subtitle service rejected the key', 'unavailable', {
        status,
      });
    }

    return new SubtitleError(apiMessage ?? `Subtitle ${action} failed`, 'fetch-failed', { status });
  }

  return new SubtitleError(
    error?.message ?? `Subtitle ${action} failed`,
    'fetch-failed',
  );
}

/**
 * The best of several results for our purpose.
 *
 * A hearing-impaired file carries sound descriptions ("[door slams]") that are
 * noise once translated, so those go last; beyond that, first is fine — Wyzie
 * orders by relevance.
 */
function pickResult(results) {
  const rank = (result) => (result.isHearingImpaired ? 1 : 0);
  return [...results].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * The best source-language subtitle for a movie or episode, as a link — without
 * downloading it.
 *
 * Split from `fetchSourceSubtitle` because the two have different costs and
 * different callers. Translating needs the bytes and pays a download for them.
 * The player only needs the *link*, and this is what a translation served out
 * of the store has to fall back on: a cached file has no job behind it, so the
 * link has to be found on its own or the English track would only ever appear
 * for the first viewer of a title.
 *
 * @param {object} request
 * @param {'movie'|'tv'} request.mediaType
 * @param {number} request.tmdbId
 * @param {number} [request.season]
 * @param {number} [request.episode]
 * @returns {Promise<{ url: string, language: string, source: string|null }>}
 * @throws {SubtitleError}
 */
export async function findSource({ mediaType, tmdbId, season, episode }) {
  const key = wyzieKey();
  if (!key) {
    throw new SubtitleError('No Wyzie API key configured', 'unavailable');
  }

  const episodeFilter =
    mediaType === 'tv' && season && episode ? { season, episode } : {};

  const query = {
    tmdb_id: tmdbId,
    language: site.subtitles.sourceLanguage,
    format: FORMATS,
    key,
    ...episodeFilter,
  };

  let results;
  try {
    results = await searchSubtitles(query);

    // The default source (charlie) is the cheapest to query, so it goes first.
    // Studios and older catalogue titles are often only on the others, and a
    // miss here is worth one wider pass rather than a title with no subtitles.
    if (!results.length) {
      results = await searchSubtitles({ ...query, source: 'all' });
    }
  } catch (error) {
    throw toSubtitleError(error, 'search');
  }

  const chosen = pickResult(results);
  if (!chosen) {
    throw new SubtitleError(
      `No ${site.subtitles.sourceLanguage} subtitle found for this title`,
      'not-found',
    );
  }

  // `to: 'vtt'` asks their server to convert when the link is followed; `plain`
  // strips the styling codes, empty lines and duplicates — noise in a player
  // just as much as in a translator's input.
  //
  // Handed to the browser as-is, which is what the library is for: its own
  // documented example is `track.src = withDownloadOptions(result, …)`. Two
  // things follow. Wyzie counts **every fetch of the link** against the key's
  // request quota, so it is worth looking up lazily rather than on every page
  // view. And it is the raw file, so it still opens with the free tier's
  // promotional card — `stripPromoCues` removes that only from the copy we
  // translate.
  return {
    url: withDownloadOptions(chosen, { to: 'vtt', plain: true }),
    language: chosen.language,
    source: chosen.source ?? null,
  };
}

/**
 * The source-language subtitle itself, ready to be torn into cues.
 *
 * @param {object} request  as `findSource`
 * @returns {Promise<{ vtt: string, url: string, language: string, source: string|null }>}
 * @throws {SubtitleError}
 */
export async function fetchSourceSubtitle(request) {
  const found = await findSource(request);

  try {
    return {
      vtt: stripPromoCues(await parseToVTT(found.url)),
      url: found.url,
      language: found.language,
      source: found.source,
    };
  } catch (error) {
    throw toSubtitleError(error, 'download');
  }
}
