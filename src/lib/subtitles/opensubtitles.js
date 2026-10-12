/**
 * ==========================================================================
 *  SUBTITLE SOURCE — OpenSubtitles v3 Stremio addon
 * ==========================================================================
 *
 *  Secondary source for when Wyzie is unavailable or cannot provide a usable
 *  subtitle. The addon indexes by IMDb id, so TMDB supplies that mapping here.
 *
 *  Server-side only.
 * ==========================================================================
 */

import { tmdbFetch } from '@/lib/tmdb/client';
import site from '@config/site';
import { SubtitleError } from './error';

const ADDON_URL = 'https://opensubtitles-v3.strem.io/subtitles';
const FETCH_TIMEOUT_MS = 15_000;

/** Resolve the IMDb id needed by the Stremio addon. */
async function resolveImdbId({ mediaType, tmdbId, imdbId }) {
  if (imdbId) return imdbId;

  const path = mediaType === 'tv' ? `tv/${tmdbId}/external_ids` : `movie/${tmdbId}`;
  const data = await tmdbFetch(path);
  return data.imdb_id ?? data.external_ids?.imdb_id ?? null;
}

/** Select a non-hearing-impaired English track when one is available. */
function chooseSubtitle(subtitles, { season, episode }) {
  const matching = (subtitles ?? []).filter(
    (subtitle) =>
      (subtitle.lang === 'eng' || subtitle.lang === 'en') &&
      (season == null || Number(subtitle.season) === season) &&
      (episode == null || Number(subtitle.episode) === episode) &&
      isAddonSubtitleUrl(subtitle.url),
  );

  return (
    matching.find((subtitle) => !/\.hi\./i.test(subtitle.subtitleFileName ?? '')) ??
    matching[0] ??
    null
  );
}

/** Only download from the subtitle hosts used by the Stremio addon. */
function isAddonSubtitleUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^subs\d+\.strem\.io$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Find an English subtitle URL without downloading its contents. */
export async function findOpenSubtitle(request) {
  let imdbId;
  try {
    imdbId = await resolveImdbId(request);
  } catch (error) {
    throw new SubtitleError(error?.message ?? 'Could not resolve the IMDb id', 'fetch-failed');
  }

  if (!imdbId) {
    throw new SubtitleError('No IMDb id is available for this title', 'not-found');
  }

  const isEpisode = request.mediaType === 'tv';
  const id = isEpisode ? `${imdbId}:${request.season}:${request.episode}` : imdbId;
  const url = `${ADDON_URL}/${isEpisode ? 'series' : 'movie'}/${id}.json`;

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SubtitleError(error?.message ?? 'OpenSubtitles lookup failed', 'fetch-failed');
  }

  if (!response.ok) {
    throw new SubtitleError(`OpenSubtitles returned ${response.status}`, 'fetch-failed');
  }

  const data = await response.json().catch(() => null);
  const chosen = chooseSubtitle(data?.subtitles, isEpisode ? request : {});
  if (!chosen) {
    throw new SubtitleError(
      `No ${site.subtitles.sourceLanguage} subtitle found in OpenSubtitles`,
      'not-found',
    );
  }

  return { url: chosen.url, language: chosen.lang, source: 'opensubtitles' };
}

/** Find and download a subtitle, rejecting responses that are not parseable text. */
export async function fetchOpenSubtitle(request) {
  const found = await findOpenSubtitle(request);

  let response;
  try {
    response = await fetch(found.url, {
      headers: { accept: 'text/plain, application/x-subrip, */*' },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SubtitleError(error?.message ?? 'OpenSubtitles download failed', 'fetch-failed');
  }

  if (!response.ok) {
    throw new SubtitleError(`OpenSubtitles download returned ${response.status}`, 'fetch-failed');
  }

  const vtt = await response.text();
  if (!vtt.trim()) {
    throw new SubtitleError('OpenSubtitles returned an empty subtitle', 'fetch-failed');
  }

  return { vtt, ...found };
}