/**
 * ============================================================================
 *  PLAYBACK PROVIDERS
 * ============================================================================
 *
 *  The rest of the app asks this module for "the embed URL for this title" and
 *  gets a string back; it never needs to know which provider is in use.
 *
 *  Which providers appear is decided by `config/site.js` → `player.servers`.
 *  Each entry names a `provider` (which URL format to use) and a `base` (which
 *  mirror of it) — list one provider twice with two bases and you get two
 *  entries in the switcher for free.
 *
 *  To add one, drop a module next to this file exporting `{ id, movie, episode }`
 *  and register it in `PROVIDERS` below.
 * ============================================================================
 */

import site from '@config/site';
import vidsrc from './vidsrc';
import vidfast from './vidfast';

/** Keyed by the `provider` field on each entry in `player.servers`. */
const PROVIDERS = { vidsrc, vidfast };

/** Every configured server, for rendering the switcher. */
export function listServers() {
  return site.player.servers;
}

/** The server object for an id, falling back to the first configured server. */
export function getServer(serverId) {
  const servers = site.player.servers;
  return servers.find((server) => server.id === serverId) ?? servers[0];
}

/** The provider module behind a configured server, or undefined. */
function providerFor(server) {
  // `provider` doubles as the provider key for entries written before the
  // field existed.
  if (!server) return undefined;
  return PROVIDERS[server.provider ?? server.id];
}

/**
 * Whether a server can play a subtitle file we hand it.
 *
 * Providers differ: vidsrc takes a `sub_url` and plays any WebVTT; VidFast
 * only selects from its own built-in tracks. The UI uses this to say so rather
 * than silently dropping the subtitle when the viewer switches servers.
 */
export function serverSupportsSubtitles(serverId) {
  return providerFor(getServer(serverId))?.supportsSubtitles === true;
}

/**
 * Embed URL for a title or an episode on a given server, or `null` when no URL
 * can be built — no servers configured, an unknown provider, or an id the
 * provider needs and we do not have.
 *
 * @param {object}  request
 * @param {'movie'|'tv'} request.mediaType
 * @param {number|string} request.tmdbId
 * @param {string}  [request.imdbId]  movies only — TMDB does not return it for shows
 * @param {number}  [request.season]
 * @param {number}  [request.episode]
 * @param {string}  [request.serverId]
 * @param {object}  [request.subtitle]  `{ url, label, lang }` for servers that
 *                                      accept one; ignored by those that do not
 */
export function embedUrl({ mediaType, tmdbId, imdbId, season, episode, serverId, subtitle }) {
  const server = getServer(serverId);
  if (!server) return null;

  const provider = providerFor(server);
  if (!provider) return null;

  // A trailing slash on the configured base would produce a doubled-up path.
  const base = String(server.base).replace(/\/+$/, '');
  const autoplay = Boolean(site.player.autoplay);

  // Withheld from providers that cannot use one, rather than trusting every
  // provider module to ignore an option it does not know.
  const options = {
    tmdbId,
    imdbId,
    season,
    episode,
    autoplay,
    subtitle: provider.supportsSubtitles ? subtitle : null,
  };

  return mediaType === 'tv'
    ? provider.episode(base, options)
    : provider.movie(base, options);
}
