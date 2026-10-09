/**
 * ============================================================================
 *  SUBTITLE SOURCE — one the provider supplied
 * ============================================================================
 *
 *  A provider brings its own subtitles, and they are the better raw material for
 *  a translation than anything we can go looking for: they were shipped with the
 *  copy of the film the viewer is actually watching, so their timings match it.
 *  A subtitle found separately is timed to a different release, and on a film
 *  that has been re-cut between regions it is timed to a different film.
 *
 *  So this is tried first, before Wyzie and before the HLS caption that
 *  `videasy-captions.js` digs out. Both of those remain as fallbacks — most
 *  providers bring nothing, and a title still has to get subtitles.
 *
 *  ---------------------------------------------------------------------------
 *  Why the URL is checked before it is fetched
 *  ---------------------------------------------------------------------------
 *
 *  This URL arrives from the browser, which means it arrives from whoever is
 *  using the browser. Our server then fetches it. That is a request-forging
 *  shape — the machine this runs on is the thing on the other end of it — and it
 *  is the same shape as the stream proxies, which is why it uses the same check.
 *
 *  A URL that fails it is not an error worth showing anyone. It means the
 *  provider sent something we will not fetch, which is an ordinary reason to
 *  fall back, not a reason to stop.
 *
 *  Server-side only.
 * ============================================================================
 */

import { fetchWithDeadline, parseRequestUrl } from '@/lib/proxy/stream';
import { SubtitleError } from './error';
import { stripPromoCues } from './promo';

/**
 * How long a subtitle file gets.
 *
 * Generous for what it is, because these come from the same hosts the video does
 * and one of them may be having a bad minute. It is still a deadline: without
 * one, a host that accepts the connection and then goes quiet would hold the
 * translation job — and the viewer's waiting screen — open until the platform
 * killed the invocation.
 */
const FETCH_TIMEOUT_MS = 15_000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
  Accept: 'text/vtt, application/x-subrip, text/plain, */*',
};

/**
 * Whether a provider's subtitle URL is one this server is willing to fetch.
 *
 * Exposed so the route can tell "the provider offered nothing" apart from "the
 * provider offered something we will not touch" without doing the fetch to find
 * out. Both lead to the same fallback; only one of them is worth a log line.
 */
export function isFetchableSubtitleUrl(value) {
  return typeof value === 'string' && Boolean(parseRequestUrl(value).url);
}

/**
 * The provider's subtitle, ready to be torn into cues.
 *
 * The bytes are handed back as they arrive. `parseSubtitle` reads SubRip and
 * WebVTT both — only the milliseconds separator differs — so there is nothing to
 * convert here, and a provider that sends SRT is not a special case.
 *
 * @param {string} url
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{vtt: string, url: string, language: string, source: string}>}
 * @throws {SubtitleError}
 */
export async function fetchProviderSubtitle(url, { signal } = {}) {
  const { url: target, reason } = parseRequestUrl(url);
  if (!target) {
    throw new SubtitleError(`Provider subtitle not fetched: ${reason}`, 'fetch-failed');
  }

  let response;
  try {
    response = await fetchWithDeadline(
      target,
      { headers: HEADERS, cache: 'no-store', signal },
      FETCH_TIMEOUT_MS,
    );
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new SubtitleError(error?.message ?? 'Provider subtitle fetch failed', 'fetch-failed');
  }

  if (!response.ok) {
    throw new SubtitleError(`Provider subtitle returned ${response.status}`, 'fetch-failed');
  }

  const vtt = await response.text();
  if (!vtt.trim()) {
    throw new SubtitleError('The provider subtitle was empty', 'fetch-failed');
  }

  return {
    // The provider's own copy carries its own advertising — two cues out of a
    // couple of thousand, at the start and at the end. Stripped here rather than
    // translated, which is what would otherwise happen to them; see `promo.js`.
    vtt: stripPromoCues(vtt),
    // The link the player is offered beside the translation. It is the same file
    // the translation was made from, which is the property that matters: an
    // English track whose timings match the picture.
    url: target.href,
    source: 'provider',
  };
}
