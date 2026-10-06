'use client';

import { useEffect, useMemo, useState } from 'react';
import site from '@config/site';
import { embedUrl, listServers, serverSupportsSubtitles } from '@/lib/providers';
import { useTranslatedSubtitle } from '@/lib/subtitles/client';
import { recordProgress } from '@/lib/storage';
import Icon from '@/components/ui/Icon';
import SubtitleProgress from '@/components/player/SubtitleProgress';

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
 *
 *  It also owns the subtitle wait. Before the player exists it prepares the
 *  translated subtitle, because the track has to be part of the URL the player
 *  loads with: attaching one afterwards means reloading the iframe, which
 *  restarts whatever the viewer was watching. So the order is subtitle first,
 *  player second — and only the first viewer of a title ever waits, since the
 *  translation is cached for everyone after them.
 * ============================================================================
 */

/** What to tell the viewer when the subtitle could not be prepared. */
function noticeFor(code) {
  switch (code) {
    case 'limit':
      return {
        title: 'Subtitle service is at its daily limit',
        body:
          'The translated subtitles for this title could not be prepared right now, so this ' +
          'is playing without them. Please try again later.',
      };
    case 'not-found':
      return {
        title: 'No subtitles to translate',
        body:
          'No subtitle exists for this title in the original language, so there was nothing ' +
          'to translate. Playing without subtitles.',
      };
    case 'timeout':
      return {
        title: 'Subtitles are taking longer than expected',
        body:
          'This is playing without them rather than making you wait. The translation carries ' +
          'on in the background and will be ready the next time you watch.',
      };
    default:
      return {
        title: 'Subtitles unavailable',
        body: 'The subtitles for this title could not be prepared. Playing without them.',
      };
  }
}

export default function EmbedPlayer({ media, season, episode }) {
  const servers = listServers();
  const [serverId, setServerId] = useState(servers[0]?.id);
  const [loading, setLoading] = useState(true);
  const [skipped, setSkipped] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const subtitle = useTranslatedSubtitle({
    mediaType: media.mediaType,
    tmdbId: media.id,
    season,
    episode,
  });

  // The player waits for the subtitle — unless the viewer would rather not.
  const preparing = subtitle.status === 'working' && !skipped;

  const track = useMemo(() => {
    if (skipped || subtitle.status !== 'ready' || !subtitle.url) return null;

    return {
      url: subtitle.url,
      label: site.subtitles.target.label,
      lang: site.subtitles.target.code,
    };
  }, [skipped, subtitle.status, subtitle.url]);

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
        subtitle: track,
      }),
    [media.mediaType, media.id, media.imdbId, season, episode, serverId, track],
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

  // The subtitle wait replaces the player entirely, so the iframe is not
  // created until there is a source URL that already includes the track.
  if (preparing) {
    return (
      <SubtitleProgress
        phase={subtitle.phase}
        progress={subtitle.progress}
        label={site.subtitles.target.label}
        nativeName={site.subtitles.target.nativeName}
        onSkip={site.subtitles.allowSkip ? () => setSkipped(true) : null}
      />
    );
  }

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

  // `unavailable` means the feature is not configured (no keys), which is a
  // deployment matter rather than something to tell a viewer about.
  const failed =
    subtitle.status === 'failed' && subtitle.code !== 'unavailable' && !skipped;
  const notice = failed ? noticeFor(subtitle.code) : null;

  // A track was prepared, but this server cannot play one. Worth saying —
  // otherwise switching servers looks like the subtitles were lost.
  const unsupportedServer = Boolean(track) && !serverSupportsSubtitles(serverId);

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

      {notice && !noticeDismissed && (
        <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-card p-3">
          <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0 text-muted" />

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{notice.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{notice.body}</p>
          </div>

          <button
            type="button"
            onClick={() => setNoticeDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded-full p-1 text-muted transition-colors hover:text-text"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {track && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Icon name="globe" size={13} />
          {unsupportedServer
            ? `${site.subtitles.target.label} subtitles are not supported on this server — try another one`
            : `${site.subtitles.target.label} subtitles loaded`}
        </p>
      )}

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
