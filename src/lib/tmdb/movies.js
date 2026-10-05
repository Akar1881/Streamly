import site from '@config/site';
import { pickLogo } from '@/lib/images';
import { tmdbFetch } from './client';
import { normaliseMedia } from './normalise';

/**
 * Everything the movie detail page needs, in ONE request.
 *
 * `append_to_response` lets TMDB bundle sub-resources into a single round trip
 * instead of six — credits, videos, images, reviews, similar titles and the
 * release certificate all come back together.
 */
export async function getMovie(id) {
  const data = await tmdbFetch(`movie/${id}`, {
    params: {
      append_to_response: 'credits,videos,images,reviews,recommendations,release_dates',
      // Title logos are language-specific; ask for the configured language and
      // untagged ones, otherwise `images.logos` often comes back empty.
      include_image_language: `${site.tmdb.language.split('-')[0]},null`,
    },
    revalidate: site.tmdb.revalidate.detail,
  });

  return shapeMovie(data);
}

function shapeMovie(data) {
  return {
    id: data.id,
    mediaType: 'movie',
    title: data.title,
    originalTitle: data.original_title,
    tagline: data.tagline || '',
    overview: data.overview || '',
    posterPath: data.poster_path,
    backdropPath: data.backdrop_path,
    releaseDate: data.release_date,
    runtime: data.runtime,
    voteAverage: data.vote_average,
    voteCount: data.vote_count,
    genres: data.genres ?? [],
    status: data.status,
    budget: data.budget,
    revenue: data.revenue,
    homepage: data.homepage,
    imdbId: data.imdb_id,
    originalLanguage: data.original_language,
    spokenLanguages: data.spoken_languages ?? [],
    productionCompanies: data.production_companies ?? [],
    productionCountries: data.production_countries ?? [],
    collection: data.belongs_to_collection ?? null,

    certification: pickCertification(data.release_dates),
    logoPath: pickLogo(data.images?.logos ?? []),
    cast: (data.credits?.cast ?? []).slice(0, site.detail.castLimit),
    crew: dedupeCrew(data.credits?.crew ?? []),
    videos: pickVideos(data.videos?.results),
    images: {
      backdrops: data.images?.backdrops ?? [],
      posters: data.images?.posters ?? [],
      logos: data.images?.logos ?? [],
    },
    reviews: data.reviews?.results ?? [],
    related: (data.recommendations?.results ?? [])
      .map((item) => normaliseMedia(item, 'movie'))
      .slice(0, site.detail.relatedLimit),
  };
}

/** The age rating for the configured region, e.g. "PG-13". */
function pickCertification(releaseDates) {
  const entries = releaseDates?.results ?? [];
  const forRegion = entries.find((entry) => entry.iso_3166_1 === site.tmdb.region);
  const certified = (forRegion?.release_dates ?? []).find((release) => release.certification);
  return certified?.certification || null;
}

/**
 * TMDB lists a person once per job, so a director who also wrote and produced
 * appears three times. Collapse to one entry with the jobs joined.
 */
function dedupeCrew(crew) {
  const byPerson = new Map();
  for (const member of crew) {
    const existing = byPerson.get(member.id);
    if (existing) existing.jobs.push(member.job);
    else byPerson.set(member.id, { ...member, jobs: [member.job] });
  }
  return [...byPerson.values()].map((member) => ({
    ...member,
    job: member.jobs.join(', '),
  }));
}

/** YouTube trailers and clips, trailers first. */
function pickVideos(videos = []) {
  const RANK = { Trailer: 0, Teaser: 1, Clip: 2, Featurette: 3, 'Behind the Scenes': 4 };
  return videos
    .filter((video) => video.site === 'YouTube')
    .sort((a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9));
}

/** The first trailer, used by the hero's Trailer button. */
export function findTrailer(videos = []) {
  return videos.find((video) => video.type === 'Trailer') ?? videos[0] ?? null;
}

/** All films in a franchise, for the Collection tab. */
export async function getCollection(collectionId) {
  const data = await tmdbFetch(`collection/${collectionId}`, {
    revalidate: site.tmdb.revalidate.detail,
  });
  return {
    id: data.id,
    name: data.name,
    overview: data.overview,
    backdropPath: data.backdrop_path,
    items: (data.parts ?? [])
      .map((part) => normaliseMedia(part, 'movie'))
      .sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '')),
  };
}

export { shapeMovie };
