import site from '@config/site';
import { tmdbFetch } from './client';
import { normaliseMedia } from './normalise';

/** Cast and crew member pages. */
export async function getPerson(id) {
  const data = await tmdbFetch(`person/${id}`, {
    params: { append_to_response: 'combined_credits,images' },
    revalidate: site.tmdb.revalidate.detail,
  });

  return {
    id: data.id,
    name: data.name,
    biography: data.biography || '',
    birthday: data.birthday,
    deathday: data.deathday,
    placeOfBirth: data.place_of_birth,
    profilePath: data.profile_path,
    knownFor: data.known_for_department,
    homepage: data.homepage,
    imdbId: data.imdb_id,

    /** Acting roles, most popular first. */
    cast: dedupeTitles(data.combined_credits?.cast ?? []),
    /** Directing/writing/producing credits. */
    crew: dedupeTitles(data.combined_credits?.crew ?? []),
  };
}

/**
 * A person can be credited several times on one title (e.g. writer and
 * director), which would show the same poster twice. Keep one card per title.
 */
function dedupeTitles(credits) {
  const seen = new Map();

  for (const credit of credits) {
    if (credit.media_type !== 'movie' && credit.media_type !== 'tv') continue;
    if (seen.has(credit.id)) continue;
    seen.set(credit.id, {
      ...normaliseMedia(credit),
      character: credit.character ?? '',
      job: credit.job ?? '',
    });
  }

  return [...seen.values()].sort((a, b) => b.popularity - a.popularity);
}
