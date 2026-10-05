import site from '@config/site';

/**
 * Builds TMDB image URLs. Every image on the site goes through here so the CDN
 * root and the size presets stay configurable from `config/site.js`.
 */

const { imageBase, sizes } = site.tmdb;

function build(path, size) {
  if (!path) return null;
  return `${imageBase}/${size}${path}`;
}

/** Vertical box art — used by every card and grid. */
export const posterUrl = (path, size = sizes.poster) => build(path, size);

/** Wide background art — hero and detail headers. */
export const backdropUrl = (path, size = sizes.backdrop) => build(path, size);

/** Episode thumbnails. */
export const stillUrl = (path, size = sizes.still) => build(path, size);

/** Cast and crew headshots. */
export const profileUrl = (path, size = sizes.profile) => build(path, size);

/** Transparent title treatments shown over the hero. */
export const logoUrl = (path, size = sizes.logo) => build(path, size);

/**
 * Picks the best title logo from a TMDB `images.logos` array, preferring the
 * configured language and PNG (which has transparency) over SVG.
 */
export function pickLogo(logos, language = site.tmdb.language.split('-')[0]) {
  if (!Array.isArray(logos) || logos.length === 0) return null;
  const byLanguage = logos.filter((logo) => logo.iso_639_1 === language);
  const pool = byLanguage.length ? byLanguage : logos;
  const png = pool.find((logo) => logo.file_path?.endsWith('.png'));
  return (png ?? pool[0]).file_path ?? null;
}
