'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import site from '@config/site';
import { listProviders, resolvePlayback } from '@/lib/providers';
import { useTranslatedSubtitle } from '@/lib/subtitles/client';
import { getProgressEntry, recordProgress } from '@/lib/storage';
import { backdropUrl, posterUrl } from '@/lib/images';
import Icon from '@/components/ui/Icon';
import VideoPlayer from '@/components/player/VideoPlayer';
import SubtitleProgress from '@/components/player/SubtitleProgress';

/**
 * ============================================================================
 *  PLAYER STAGE
 * ============================================================================
 *  Everything around the player on a watch page: which provider to ask, the
 *  translated subtitle, the source menu, and the states in between.
 *  `VideoPlayer` itself is told nothing but URLs — and, so that its own menu can
 *  offer the choice, the list of sources it could be asked for instead. It still
 *  knows what none of them are: it is handed a codename to print and an id to
 *  hand back, and asking the new one is this file's job.
 *
 *  The order of business is deliberate:
 *
 *    1. No provider configured — say so, and say where to add one. A watch
 *       page with no source is a configuration state, not a broken page, and
 *       it should read as one.
 *    2. The subtitle is being translated and the viewer wants it — wait, with
 *       the progress screen. The wait is only for the *first* viewer of a
 *       title; the translation is cached, so everyone after them goes straight
 *       to the player. Waiting is worth it because starting the film and
 *       gaining subtitles halfway through is worse than starting late.
 *    3. Ask the provider. Async, cancellable — a viewer who leaves mid-request
 *       should not leave a request running.
 *    4. Play.
 *
 *  The subtitle and the source are resolved independently and in parallel, so
 *  a slow translation never delays the provider and a slow provider never
 *  delays the translation.
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

/**
 * The same list with `id` added, or the same list back if it is already there.
 *
 * Returning the original array rather than a fresh equal one matters: this is
 * handed to `setState` on every resolve, and a new array each time would
 * re-render the player — and so re-run every effect that depends on it — each
 * time a provider was re-asked.
 */
function withUnavailable(list, id) {
  return list.includes(id) ? list : [...list, id];
}

/** The box shown in place of the player when there is nothing to play. */
function NoSource({ title, body, children }) {
  return (
    <div
      className="grid aspect-video w-full place-items-center rounded-[var(--radius-card)]
        border border-line bg-card px-6 text-center"
    >
      <div className="flex max-w-sm flex-col items-center gap-2">
        <Icon name="alert-circle" size={24} className="text-muted" />
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-muted">{body}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * The way out of a dead source.
 *
 * Every state below ends here, because "when will this be back" is the question
 * the copy cannot answer and the channel is where it gets answered. It is a real
 * link rather than a button so it can be middle-clicked, copied, or opened in a
 * new tab by a viewer who is not finished with the page they are on.
 */
function ChannelLink() {
  return (
    <a
      href={site.player.unavailable.channel.href}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border
        border-line px-3 py-1.5 text-xs text-muted transition-colors hover:text-text"
    >
      <Icon name="send" size={13} />
      {site.player.unavailable.channel.label}
    </a>
  );
}

/**
 * @param {object} props
 * @param {object} props.media       a movie or show from `src/lib/tmdb/` — needs
 *                                   `id`, `mediaType`, `title`; `imdbId` for movies
 * @param {number} [props.season]    episodes only
 * @param {number} [props.episode]   episodes only
 */
export default function PlayerStage({ media, season, episode }) {
  const providers = useMemo(() => listProviders(), []);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? null);
  const [playback, setPlayback] = useState(null);
  const [resolving, setResolving] = useState(true);
  const [failed, setFailed] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  /**
   * Bumped by the retry button. It is in the resolve effect's dependencies and
   * nowhere else, so re-asking the provider is a re-render rather than a second
   * code path that could drift from the first.
   */
  const [attempt, setAttempt] = useState(0);

  /**
   * Where to pick playback up, in seconds; 0 means "from the beginning".
   *
   * Read in an effect rather than during render because it comes from
   * localStorage, which the server does not have — a value that only exists in
   * the browser would make the first paint disagree with the markup.
   *
   * Held in state rather than looked up on demand so the player is given one
   * `startAt` for the life of the page. It is deliberately never re-read as
   * playback goes on: the position being written back is this title's own, so
   * re-reading it would only fight the write.
   */
  const [startAt, setStartAt] = useState(0);

  /**
   * Which providers have come back with nothing for this title.
   *
   * Session state, on purpose. A provider that has nothing for a title will not
   * have it a moment later, so re-asking on every render would be a request per
   * render that cannot change its answer — but a provider that is merely down is
   * worth trying again the next time the viewer opens a title, and starting from
   * empty here is what makes that free.
   */
  const [unavailableIds, setUnavailableIds] = useState([]);

  const subtitle = useTranslatedSubtitle({
    mediaType: media.mediaType,
    tmdbId: media.id,
    season,
    episode,
  });

  // The translated track, once it exists. `default` is what makes the player
  // turn it on by itself — on a Sorani site this is the track the viewer came
  // for, so having to open the captions menu to get it would be absurd.
  const track = useMemo(() => {
    if (skipped || subtitle.status !== 'ready' || !subtitle.url) return null;

    return {
      src: subtitle.url,
      label: site.subtitles.target.label,
      lang: site.subtitles.target.code,
      default: Boolean(site.subtitles.autoSelect),
    };
  }, [skipped, subtitle.status, subtitle.url]);

  // The original-language subtitle, as the same kind of link. It is the file
  // the translation was made *from*, so it is gated on neither the translation
  // being ready nor the viewer having skipped waiting for it: a viewer who
  // skipped the wait gets English, they just do not get Sorani. Nor is it gated
  // on the title being new — the status endpoint looks the link up for a title
  // that was translated long ago and is served from the store, so an English
  // track appears beside the Sorani one however the Sorani one was obtained.
  //
  // It is null for the handful of titles whose source subtitle only exists as
  // an HLS caption, which has no link to hand out.
  //
  // Never `default`: it is the second choice on this site, not the first.
  const original = useMemo(() => {
    if (!subtitle.sourceUrl) return null;

    return {
      src: subtitle.sourceUrl,
      label: site.subtitles.sourceLanguageLabel ?? site.subtitles.sourceLanguage,
      lang: site.subtitles.sourceLanguage,
      default: false,
    };
  }, [subtitle.sourceUrl]);

  // Whatever the provider offered, plus ours. Ours goes last so a provider's
  // own tracks keep the order it chose; `default` decides which one is on, not
  // the position.
  //
  // `default` has to be exclusive, though, and the player resolves it by taking
  // the *first* track that claims it. With our track appended last, a provider
  // that marks one of its own as default would win that draw and the translation
  // would arrive switched off — on a Sorani site, the one track the viewer came
  // for. So when ours is the default, the others stop claiming it. They stay in
  // the menu, one click away.
  const tracks = useMemo(() => {
    const offered = playback?.tracks ?? [];
    if (!track) return original ? [...offered, original] : offered;

    const others = [
      ...offered,
      ...(original ? [original] : []),
    ];

    return track.default
      ? [...others.map(({ default: _isDefault, ...rest }) => rest), track]
      : [...others, track];
  }, [playback, track, original]);

  /**
   * Ask the selected provider what to play.
   *
   * Keyed on the ids rather than on `media`, because the object identity is
   * not something this component controls and a new one every render would
   * re-ask the provider forever.
   */
  useEffect(() => {
    if (!providerId) {
      setPlayback(null);
      setResolving(false);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    setResolving(true);
    setFailed(false);

    resolvePlayback({
      providerId,
      mediaType: media.mediaType,
      tmdbId: media.id,
      imdbId: media.imdbId,
      season,
      episode,
      signal: controller.signal,
    })
      .then((result) => {
        if (cancelled) return;
        setPlayback(result);
        // A provider answering with a stream clears its mark; `resolvePlayback`
        // flattens a miss and a throw into the same `null`, so this is the one
        // place that can tell "it works" from "not this one".
        setUnavailableIds((current) =>
          result ? current.filter((id) => id !== providerId) : withUnavailable(current, providerId),
        );
        setResolving(false);
      })
      .catch((cause) => {
        if (cancelled || cause?.name === 'AbortError') return;
        // A provider that throws is a fault, which is a different sentence to
        // the viewer than "this title is not here".
        setPlayback(null);
        setFailed(true);
        setUnavailableIds((current) => withUnavailable(current, providerId));
        setResolving(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [providerId, media.mediaType, media.id, media.imdbId, season, episode, attempt]);

  /**
   * The viewer picking a source from the player's menu.
   *
   * Choosing the one already selected is not a no-op: on a source that has just
   * failed it is the same request the Retry button makes, and the menu is where
   * a viewer who has just been told the source is unavailable is most likely to
   * ask again — so it re-asks. On a source that is playing it means nothing, and
   * is ignored rather than tearing down a working stream to re-resolve it.
   */
  const chooseProvider = useCallback(
    (id) => {
      if (id === providerId) {
        if (failed) setAttempt((count) => count + 1);
        return;
      }
      setProviderId(id);
    },
    [providerId, failed],
  );

  /**
   * Where the viewer left off, if that is still worth returning to.
   *
   * The stored history is keyed by title, not by episode, so for a show the
   * position only applies when the episode being opened is the one it was
   * recorded against — otherwise watching S2E1 would resume at whatever minute
   * S1E5 was abandoned at.
   */
  useEffect(() => {
    if (!site.player.saveProgress) return;

    const entry = getProgressEntry(media.mediaType, media.id);
    if (!entry) return;

    if ((entry.season ?? null) !== (season ?? null)) return;
    if ((entry.episode ?? null) !== (episode ?? null)) return;

    const seconds = entry.seconds ?? 0;
    const duration = entry.duration ?? 0;
    const { minSeconds, nearEndSeconds } = site.player.resume;

    // Too near either end to be a place anyone wants to be put back.
    if (seconds < minSeconds) return;
    if (duration > 0 && duration - seconds < nearEndSeconds) return;

    setStartAt(seconds);
  }, [media.mediaType, media.id, season, episode]);

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

  /**
   * Moves the stored position as the title plays.
   *
   * `recordProgress` merges rather than replaces, so this carries the card's
   * fields only because it has to pass the full entry — the position is the
   * part that changes.
   */
  const handleProgress = useCallback(
    (seconds, duration) => {
      if (!site.player.saveProgress) return;
      recordProgress({
        id: media.id,
        mediaType: media.mediaType,
        title: media.title,
        posterPath: media.posterPath,
        backdropPath: media.backdropPath,
        season: season ?? null,
        episode: episode ?? null,
        seconds,
        duration,
      });
    },
    [media, season, episode],
  );

  // --- nothing to play -----------------------------------------------------
  if (providers.length === 0) {
    return (
      <NoSource
        title="No playback source configured"
        body={
          <>
            Add a provider id to <code className="text-text">player.providers</code> in
            config/site.js and register its module in{' '}
            <code className="text-text">src/lib/providers/</code> — the shape to return is
            documented at the top of that directory&rsquo;s index.js.
          </>
        }
      />
    );
  }

  // --- waiting for the translation ----------------------------------------
  const waiting = site.subtitles.autoSelect && subtitle.status === 'working' && !skipped;

  if (waiting) {
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

  const playing = season && episode ? `${media.title} — S${season}E${episode}` : media.title;

  // `unavailable` means the feature is not configured (no keys), which is a
  // deployment matter rather than something to tell a viewer about.
  const subtitleFailed =
    subtitle.status === 'failed' && subtitle.code !== 'unavailable' && !skipped;
  const notice = subtitleFailed ? noticeFor(subtitle.code) : null;

  // A provider that threw and a provider that answered "not here" are two
  // different sentences to the viewer — see `player.unavailable` in the config.
  const unavailable = failed
    ? site.player.unavailable.failed
    : site.player.unavailable.missing;

  // The provider's own still if it has one, then TMDB's backdrop art, then the
  // box art. The order is quality and shape, not preference: the player is a
  // wide, full-width element, and a 342px-wide poster stretched across it is
  // visibly soft. The backdrop is `w1280` and already 16:9, so it fills the
  // frame edge to edge.
  const poster =
    playback?.poster ??
    backdropUrl(media.backdropPath) ??
    posterUrl(media.posterPath) ??
    undefined;

  return (
    <div className="space-y-3">
      {resolving ? (
        <div
          className="grid aspect-video w-full place-items-center rounded-[var(--radius-card)]
            border border-line bg-black"
        >
          <Icon name="loader" size={28} className="animate-spin text-white/60" />
        </div>
      ) : playback ? (
        <VideoPlayer
          sources={playback.sources}
          tracks={tracks}
          poster={poster}
          title={playing}
          autoplay={site.player.autoplay}
          startAt={startAt}
          onProgress={handleProgress}
          providers={providers}
          providerId={providerId}
          unavailable={unavailableIds}
          onSelectProvider={chooseProvider}
        />
      ) : (
        <NoSource title={unavailable.title} body={unavailable.body}>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            {/* Only the failure gets a retry. A provider that says it has
                nothing for this title will say the same thing a second later,
                and a button that never changes the answer is worse than none. */}
            {failed && (
              <button
                type="button"
                onClick={() => setAttempt((count) => count + 1)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)]
                  bg-accent px-3 py-1.5 text-xs font-medium text-accent-text transition-opacity
                  hover:opacity-90"
              >
                <Icon name="rotate-cw" size={13} />
                {site.player.unavailable.retry}
              </button>
            )}

            <ChannelLink />
          </div>
        </NoSource>
      )}

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

      {/* The translated track is the point of this site, so its state is worth
          a line — otherwise a viewer who skipped the wait cannot tell whether
          the subtitles are missing or simply switched off. */}
      {subtitle.status === 'working' && !track && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Icon name="loader" size={13} className="animate-spin" />
          Preparing {site.subtitles.target.label} subtitles…
        </p>
      )}

      {track && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Icon name="globe" size={13} />
          {site.subtitles.target.label} subtitles loaded
        </p>
      )}
    </div>
  );
}
