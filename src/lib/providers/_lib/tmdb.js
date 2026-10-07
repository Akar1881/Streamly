// tmdb.js — Nuvio hands each scraper a tmdbId, but several providers match on
// title/year/imdb. This resolves tmdbId -> { title, year, imdbId } using the
// same key + proxy fallback PlayTorrio used.
const TMDB_API_KEY = 'b3556f3b206e16f82df4d1f6fd4545e6';
const DIRECT = 'https://api.themoviedb.org/3';
const PROXY = 'https://db.speedracelight.com/3'; // used if the direct call fails
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const { fetchT } = require('./http');

// Small module-level cache: several providers resolve the same tmdbId in one
// Nuvio query, and Nuvio may re-query; this avoids repeat TMDB round-trips.
const _cache = new Map();

async function fetchMeta(base, kind, tmdbId, withKey) {
  const key = withKey ? `&api_key=${TMDB_API_KEY}` : '';
  const url = `${base}/${kind}/${tmdbId}?append_to_response=external_ids${key}`;
  const res = await fetchT(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 6000);
  if (!res.ok) return null;
  return res.json();
}

// Returns { title, year, imdbId } or null.
async function resolveMeta(tmdbId, mediaType) {
  const kind = mediaType === 'tv' ? 'tv' : 'movie';
  const ck = `${kind}:${tmdbId}`;
  if (_cache.has(ck)) return _cache.get(ck);
  let j = null;
  try { j = await fetchMeta(DIRECT, kind, tmdbId, true); } catch (e) {}
  if (!j) { try { j = await fetchMeta(PROXY, kind, tmdbId, false); } catch (e) {} }
  if (!j) return null;

  const title = kind === 'tv' ? (j.name || j.original_name) : (j.title || j.original_title);
  const dateStr = kind === 'tv' ? j.first_air_date : j.release_date;
  const year = dateStr ? parseInt(String(dateStr).slice(0, 4), 10) : null;
  const imdbId = (j.external_ids && j.external_ids.imdb_id) || j.imdb_id || null;
  const meta = { title, year, imdbId };
  _cache.set(ck, meta);
  return meta;
}

module.exports = { resolveMeta, TMDB_API_KEY, DIRECT, UA };
