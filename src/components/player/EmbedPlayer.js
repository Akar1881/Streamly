'use client';

import { useEffect, useMemo, useState } from 'react';
import site from '@config/site';
import { embedUrl, listServers } from '@/lib/providers';
import { recordProgress } from '@/lib/storage';
import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  EMBED PLAYER
 * ============================================================================
 *  Renders the third-party player in an iframe and lets the visitor switch
 *  between the servers listed in `config/site.js`.
 *
 *  This component never touches provider URLs itself — it asks
 *  `src/lib/providers/` for them, so a new provider or a change in URL format
 *  never reaches this file.
 * ============================================================================
 */
export default function EmbedPlayer({ media, season, episode }) {
  const servers = listServers();
  const [serverId, setServerId] = useState(servers[0]?.id);
  const [loading, setLoading] = useState(true);

  // Each provider decides which id it wants; some want IMDB, some TMDB. Both
  // are handed over and the provider module picks. `imdbId` is only present on
  // movies (TMDB returns it as `imdb_id`), which is exactly where it is wanted.
  const source = useMemo(
    () =>
      embedUrl({
        mediaType: media.mediaType,
        tmdbId: media.id,
        imdbId: media.imdbId,
        season,
        episode,
        serverId,
      }),
    [media.mediaType, media.id, media.imdbId, season, episode, serverId],
  );

  /** Remember this title so the home page can offer "Continue watching". */
  useEffect(() => {
    if (!site.player.saveProgress) return;
    recordProgress({
      id: media.id,
      mediaType: media.mediaType,
      title: media.title,
      posterPath: media.posterPath,
      backdropPath: media.backdropPath,
      season: season ?? null,
      episode: episode ?? null,
    });
  }, [media, season, episode]);

  /** Show the spinner again whenever the source changes. */
  useEffect(() => {
    setLoading(true);
  }, [source]);

  if (!source) {
    return (
      <div className="grid aspect-video place-items-center rounded-[var(--radius-card)] border border-line bg-card">
        <div className="flex flex-col items-center gap-2 text-center">
          <Icon name="alert-circle" size={24} className="text-muted" />
          <p className="text-sm font-medium">No playback source</p>
          <p className="max-w-xs text-xs text-muted">
            Check that <code className="text-text">player.servers</code> is set in config/site.js.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-black">
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black">
            <Icon name="loader" size={28} className="animate-spin text-white/60" />
          </div>
        )}

        <iframe
          key={source}
          src={source}
          title={media.title}
          onLoad={() => setLoading(false)}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="origin"
          className="absolute inset-0 h-full w-full"
        />
      </div>

      {/* ---------------- server switcher ---------------- */}
      {servers.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Source:</span>

          {servers.map((server) => (
            <button
              key={server.id}
              type="button"
              onClick={() => setServerId(server.id)}
              aria-pressed={server.id === serverId}
              className={`rounded-[var(--radius-pill)] border px-3 py-1 text-xs transition-colors
                ${
                  server.id === serverId
                    ? 'border-transparent bg-accent text-accent-text'
                    : 'border-line bg-card text-muted hover:text-text'
                }`}
            >
              {server.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted">
        Playback is provided by a third party. If a source does not load, try another one.
      </p>
    </div>
  );
}
