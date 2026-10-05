/**
 * Shape normalisation — pure, with no server-only imports.
 *
 * Lives in its own module because Client Components need it too, and importing
 * it from `catalog.js` would drag `client.js` (which reads the API key) into
 * the browser bundle.
 */

/**
 * Flattens TMDB's two different title/date field names into one shape, so no
 * component ever has to ask "is this a movie or a show?" just to show a card.
 */
export function normaliseMedia(item, mediaTypeHint = null) {
  const mediaType = item.media_type ?? mediaTypeHint ?? (item.title ? 'movie' : 'tv');

  return {
    id: item.id,
    mediaType,
    title: item.title ?? item.name ?? '',
    originalTitle: item.original_title ?? item.original_name ?? '',
    overview: item.overview ?? '',
    posterPath: item.poster_path ?? null,
    backdropPath: item.backdrop_path ?? null,
    releaseDate: item.release_date ?? item.first_air_date ?? null,
    voteAverage: item.vote_average ?? 0,
    voteCount: item.vote_count ?? 0,
    genreIds: item.genre_ids ?? [],
    popularity: item.popularity ?? 0,
  };
}

/**
 * Same idea for episodes.
 *
 * Needed in two places: `getSeason` on the server, and `SeasonSection` in the
 * browser when the visitor switches season. Both must produce the same shape,
 * or episode cards silently lose their thumbnails and numbering.
 */
export function normaliseEpisode(episode, seasonNumberFallback = null) {
  return {
    id: episode.id,
    episodeNumber: episode.episode_number,
    seasonNumber: episode.season_number ?? seasonNumberFallback,
    name: episode.name ?? '',
    overview: episode.overview ?? '',
    stillPath: episode.still_path ?? null,
    airDate: episode.air_date ?? null,
    runtime: episode.runtime ?? null,
    voteAverage: episode.vote_average ?? 0,
  };
}
