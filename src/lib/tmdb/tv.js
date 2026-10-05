import site from '@config/site';
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
