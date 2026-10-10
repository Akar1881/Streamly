import site from '@config/site';
import { daysUntil } from '@/lib/format';
import { pickLogo } from '@/lib/images';
import { tmdbFetch } from './client';
import { normaliseEpisode, normaliseMedia } from './normalise';

/**
 * Everything the TV detail page needs, in one request.
 * Mirrors `getMovie` in ./movies.js — the two shapes are deliberately kept as
 * similar as possible so detail components can be shared.
 */
export async function getShow(id) {
  const data = await tmdbFetch(`tv/${id}`, {
    params: {
      append_to_response:
        'credits,aggregate_credits,videos,images,reviews,recommendations,content_ratings',
      include_image_language: `${site.tmdb.language.split('-')[0]},null`,
    },
    revalidate: site.tmdb.revalidate.detail,
  });

  return {
    id: data.id,
    mediaType: 'tv',
    title: data.name,
    originalTitle: data.original_name,
    tagline: data.tagline || '',
    overview: data.overview || '',
    posterPath: data.poster_path,
    backdropPath: data.backdrop_path,
    releaseDate: data.first_air_date,
    lastAirDate: data.last_air_date,
    runtime: data.episode_run_time?.[0] ?? null,
    voteAverage: data.vote_average,
    voteCount: data.vote_count,
    genres: data.genres ?? [],
    status: data.status,
    type: data.type,
    homepage: data.homepage,
    originalLanguage: data.original_language,
    spokenLanguages: data.spoken_languages ?? [],
    networks: data.networks ?? [],
    productionCompanies: data.production_companies ?? [],
    productionCountries: data.production_countries ?? [],
    createdBy: data.created_by ?? [],
    numberOfSeasons: data.number_of_seasons ?? 0,
    numberOfEpisodes: data.number_of_episodes ?? 0,
    inProduction: data.in_production,
    nextEpisodeToAir: data.next_episode_to_air ?? null,

    // Specials (season 0) are hidden — they break "start from S1E1".
    seasons: (data.seasons ?? []).filter((season) => season.season_number > 0),

    certification: pickContentRating(data.content_ratings),
    logoPath: pickLogo(data.images?.logos ?? []),
    cast: pickCast(data),
    crew: data.credits?.crew ?? [],
    videos: pickVideos(data.videos?.results),
    images: {
      backdrops: data.images?.backdrops ?? [],
      posters: data.images?.posters ?? [],
      logos: data.images?.logos ?? [],
    },
    reviews: data.reviews?.results ?? [],
    related: (data.recommendations?.results ?? [])
      .map((item) => normaliseMedia(item, 'tv'))
      .slice(0, site.detail.relatedLimit),
  };
}

/**
 * `aggregate_credits` spans the whole series and is far more accurate than the
 * single-season `credits`, but it nests roles one level deeper.
 */
function pickCast(data) {
  const aggregate = data.aggregate_credits?.cast;
  if (aggregate?.length) {
    return aggregate.slice(0, site.detail.castLimit).map((person) => ({
      ...person,
      character: person.roles?.[0]?.character ?? '',
    }));
  }
  return (data.credits?.cast ?? []).slice(0, site.detail.castLimit);
}

function pickContentRating(contentRatings) {
  const entries = contentRatings?.results ?? [];
  const forRegion = entries.find((entry) => entry.iso_3166_1 === site.tmdb.region);
  return forRegion?.rating || entries[0]?.rating || null;
}

function pickVideos(videos = []) {
  const RANK = { Trailer: 0, Teaser: 1, Clip: 2, Featurette: 3, 'Behind the Scenes': 4 };
  return videos
    .filter((video) => video.site === 'YouTube')
    .sort((a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9));
}

/** The episode list for one season. */
export async function getSeason(showId, seasonNumber) {
  const data = await tmdbFetch(`tv/${showId}/season/${seasonNumber}`, {
    revalidate: site.tmdb.revalidate.detail,
  });

  return {
    id: data.id,
    name: data.name,
    overview: data.overview,
    posterPath: data.poster_path,
    airDate: data.air_date,
    seasonNumber: data.season_number,
    episodes: (data.episodes ?? []).map((episode) =>
      normaliseEpisode(episode, data.season_number),
    ),
  };
}

/**
 * Every episode of this show that has not aired yet, soonest first.
 *
 * TMDB's show payload carries only the single `next_episode_to_air`, so the
 * full list is assembled from the seasons that can still hold unreleased
 * episodes: the one the next episode belongs to (a season airing weekly has a
 * premiere date in the past) plus any season that has not premiered yet. Those
 * extra requests are cached with the rest of the detail data, so only the
 * first visitor after a revalidation pays for them.
 *
 * Returns `[]` for a show that has finished, so callers can simply hide the UI.
 */
export async function getUpcomingEpisodes({ id, seasons = [], nextEpisodeToAir } = {}) {
  const today = new Date().toISOString().slice(0, 10);

  const candidates = new Set();
  if (nextEpisodeToAir?.season_number > 0) {
    candidates.add(nextEpisodeToAir.season_number);
  }
  for (const season of seasons) {
    // A season with no air date may simply not have been scheduled yet.
    if (season.season_number > 0 && (!season.air_date || season.air_date >= today)) {
      candidates.add(season.season_number);
    }
  }

  // Cap the fan-out: a show with a dozen announced seasons is not worth a
  // dozen requests, and the soonest seasons are the lowest-numbered ones.
  const numbers = [...candidates].sort((a, b) => a - b).slice(0, 4);
  const fetched = await Promise.all(
    numbers.map((number) => getSeason(id, number).catch(() => null)),
  );

  return fetched
    .flatMap((season) => season?.episodes ?? [])
    .filter((episode) => episode.airDate && episode.airDate >= today)
    .sort((a, b) => a.airDate.localeCompare(b.airDate) || a.episodeNumber - b.episodeNumber);
}

/**
 * Works out which episode comes before and after the current one, crossing
 * season boundaries. Drives the player's prev/next buttons.
 */
export function neighbourEpisodes(seasons, seasonNumber, episodeNumber) {
  const flat = [];
  for (const season of seasons) {
    for (let ep = 1; ep <= (season.episode_count ?? 0); ep += 1) {
      flat.push({ season: season.season_number, episode: ep });
    }
  }

  const index = flat.findIndex(
    (item) => item.season === Number(seasonNumber) && item.episode === Number(episodeNumber),
  );
  if (index === -1) return { previous: null, next: null };

  return {
    previous: flat[index - 1] ?? null,
    next: flat[index + 1] ?? null,
  };
}

/**
 * The next episode that can actually be watched, with the art and the title the
 * player's end-of-episode card needs.
 *
 * `neighbourEpisodes` answers with numbers, because that is all the prev/next
 * links print. A card that shows a thumbnail and a name needs the record, and
 * the record for an episode in the season being watched is already in hand —
 * `seasonData` is the same fetch the page made for itself, so the common case
 * costs nothing.
 *
 * Crossing a season boundary is the only case that needs the network, and only
 * then is the neighbouring season fetched. It is cached with the rest of the
 * detail data, so it is a request per revalidation window, not per visitor.
 *
 * `null` means there is nothing to offer, which is two situations the caller
 * does not have to tell apart: the show has ended, or the next episode has not
 * aired yet. An episode with a future air date has nothing to play, so offering
 * it would be a card that leads to a countdown.
 */
export async function getNextEpisode(showId, seasons, seasonData, seasonNumber, episodeNumber) {
  const { next } = neighbourEpisodes(seasons, seasonNumber, episodeNumber);
  if (!next) return null;

  let episode = null;
  if (next.season === Number(seasonNumber)) {
    episode = seasonData.episodes.find((item) => item.episodeNumber === next.episode) ?? null;
  } else {
    const ahead = await getSeason(showId, next.season).catch(() => null);
    episode = ahead?.episodes.find((item) => item.episodeNumber === next.episode) ?? null;
  }

  if (!episode || (daysUntil(episode.airDate) ?? 0) > 0) return null;

  return episode;
}
