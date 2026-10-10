'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import site from '@config/site';
import { listProviders, resolveBestPlayback } from '@/lib/providers';
import { useTranslatedSubtitle } from '@/lib/subtitles/client';
import { dedupeTracks, pickSourceTrack } from '@/lib/player/tracks';
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
 *    3. Ask every provider, and play the best answer. Async, cancellable — a
 *       viewer who leaves mid-request should not leave a request running. "Best"
 *       is measured rather than assumed: each stream is probed for the
 *       resolution it tops out at, and the widest one wins, with the config
 *       order settling ties. See `resolveBestPlayback` in
 *       `src/lib/providers/index.js` for why this is worth a resolve per
 *       provider on every title.
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
 * @param {object} [props.next]      the episode after this one, for the card the
 *                                   player offers near the end — `{ href, code,
 *                                   title, still }`, resolved by the watch page.
 *                                   Absent for movies and for a show's finale.
 * @param {object} [props.segments]  the skippable intro, recap and outro ranges
 *                                   for this title — `{ recap, intro, outro }`,
 *                                   each `{ start, end }` in seconds or null.
 *                                   Absent when the community has not timed the
 *                                   title, which is the common case.
 */
export default function PlayerStage({ media, season, episode, next, segments }) {
  const providers = useMemo(() => listProviders(), []);

  /**
   * Which provider is playing, chosen by us and changeable by the viewer.
   *
   * Null until the comparison comes back, which is why it can no longer be
   * seeded from the config: the whole point of this page is that the first id in
   * `player.providers` is a tie-break rather than an answer.
   */
  const [providerId, setProviderId] = useState(null);
  const [playback, setPlayback] = useState(null);
  const [resolving, setResolving] = useState(true);
  const [failed, setFailed] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  /**
   * Bumped by the retry button. It is in the resolve effect's dependencies and
   * nowhere else, so re-asking every provider is a re-render rather than a
   * second code path that could drift from the first.
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
   * What every provider said about this title, and how good it turned out to be.
   *
   * All of them, not just the winner, because three things need the rest: the
   * menu marks the ones that came up empty, it reads each one's measured quality
   * to say why the choice went where it did, and switching to one is then a
   * lookup rather than a second round of requests.
   *
   * Session state, on purpose. A provider that has nothing for a title will not
   * have it a moment later, so re-asking on every render would be a request per
   * render that cannot change its answer — but a provider that is merely down is
   * worth trying again the next time the viewer opens a title, and starting from
   * empty here is what makes that free.
   */
  const [answers, setAnswers] = useState([]);

  /**
   * The subtitles the playing provider brought, reduced to one per language.
   *
   * Reduced here rather than at the provider, because this is the first place
   * that has the whole list in hand and a reason to care: a provider is right to
   * report everything it has — that is a fact about the source — while a menu is
   * a thing somebody has to read.
   */
  const providerTracks = useMemo(() => dedupeTracks(playback?.tracks ?? []), [playback]);

  /**
   * The file the translation is made from, decided once and then left alone.
   *
   * Once, because the alternative is worse in both directions. Deciding it on
   * every render would re-run a translation every time the viewer changed
   * source; deciding it never would mean the answer arrived too late to be used.
   * So it is settled at the first moment it *can* be — when the providers have
   * finished answering — and it does not move after that.
   *
   * `null` is "not decided yet" and is what holds the translation back. That is
   * the whole fix for the ordering: the hook used to start the moment the page
   * mounted, which is before any provider has said whether it has a subtitle,
   * so it always translated Wyzie's copy and the provider's own file — the one
   * timed to the picture being watched — was never used at all.
   */
  const [translationSource, setTranslationSource] = useState(null);

  useEffect(() => {
    if (resolving || translationSource) return;

    const pick = pickSourceTrack(
      providerTracks,
      site.subtitles.sourceLanguageLabel ?? site.subtitles.sourceLanguage,
    );

    // Wrapped rather than stored bare, so that "no provider subtitle" is a
    // decision that has been made rather than one still pending.
    setTranslationSource({ url: pick?.src ?? null });
  }, [resolving, providerTracks, translationSource]);

  const subtitle = useTranslatedSubtitle({
    mediaType: media.mediaType,
    tmdbId: media.id,
    season,
    episode,
    sourceUrl: translationSource?.url ?? null,
    providerSettled: translationSource !== null,
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
  // an HLS caption, which has no link to hand out. It is also dropped from the
  // menu when the provider brought its own subtitles — but not because it stops
  // being true: it is still the file this translation was made from, and it is
  // what the viewer would have got before any provider started offering them.
  // It is a second English track for the same film, and one is enough.
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

  /**
   * The captions menu's list: the provider's own subtitles, then ours.
   *
   * A provider that brought subtitles brought its own English along with them,
   * so Wyzie's copy is only added when there were none — otherwise the menu
   * would offer two English tracks for one film, from two different releases,
   * with nothing to say which was which. The translated track is added either
   * way: it is the reason the site exists, not a fallback.
   *
   * `default` has to be exclusive, and the player resolves it by taking the
   * *first* track that claims it. With our track appended last, a provider that
   * marked one of its own as default would win that draw and the translation
   * would arrive switched off — on a Sorani site, the one track the viewer came
   * for. So when ours is the default, the others stop claiming it. They stay in
   * the menu, one click away.
   */
  const tracks = useMemo(() => {
    const others = [
      ...providerTracks,
      ...(providerTracks.length || !original ? [] : [original]),
    ];

    if (!track) return others;

    return track.default
      ? [...others.map(({ default: _isDefault, ...rest }) => rest), track]
      : [...others, track];
  }, [providerTracks, track, original]);

  /**
   * Ask every provider what to play, and start the best of them.
   *
   * Keyed on the ids rather than on `media`, because the object identity is
   * not something this component controls and a new one every render would
   * re-ask the provider forever. It is deliberately *not* keyed on `providerId`
   * any more: every provider is asked once per title regardless, so the viewer
   * choosing a different one is a switch to an answer already in hand, not a
   * reason to ask again.
   */
  useEffect(() => {
    if (providers.length === 0) {
      setPlayback(null);
      setAnswers([]);
      setResolving(false);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    setResolving(true);
    setFailed(false);

    resolveBestPlayback({
      mediaType: media.mediaType,
      tmdbId: media.id,
      imdbId: media.imdbId,
      season,
      episode,
      signal: controller.signal,
    })
      .then(({ chosen, answers: asked }) => {
        if (cancelled) return;

        setAnswers(asked);
        setProviderId(chosen?.providerId ?? null);
        setPlayback(chosen?.playback ?? null);
        // Nothing playable because everyone came up empty is a different
        // sentence to the viewer than nothing playable because something broke,
        // and only this side can tell them apart: a timeout and a thrown error
        // are both the second kind, and both are worth a retry button.
        setFailed(!chosen && asked.some((answer) => answer.threw || answer.gaveUp));
        setResolving(false);
      })
      .catch((cause) => {
        if (cancelled || cause?.name === 'AbortError') return;
        setPlayback(null);
        setFailed(true);
        setResolving(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [providers, media.mediaType, media.id, media.imdbId, season, episode, attempt]);

  /**
   * The viewer picking a source from the player's menu.
   *
   * Every provider was already asked for this title, so this is a switch between
   * answers rather than a request — which is the difference between the menu
   * being instant and it making the viewer wait a second and a half to change
   * their mind. A provider that came back empty is not selectable at all, so
   * there is nothing here for the "ask again" case the menu used to carry.
   */
  const chooseProvider = useCallback(
    (id) => {
      const answer = answers.find((entry) => entry.providerId === id);
      if (!answer?.playback) return;

      setProviderId(id);
      setPlayback(answer.playback);
    },
    [answers],
  );

  /** Sources that came up empty for this title — the menu strikes them out. */
  const unavailableIds = useMemo(
    () => answers.filter((answer) => !answer.playback).map((answer) => answer.providerId),
    [answers],
  );

  /**
   * How good each source turned out to be, by id.
   *
   * Shown in the source menu so the automatic choice is legible rather than
   * mysterious. A viewer who sees the site pick the second entry deserves to
   * know it picked it for a reason, and "2160p" next to one name and "800p"
   * next to the other is that reason in the space of four characters.
   */
  const qualities = useMemo(
    () =>
      Object.fromEntries(
        answers
          .filter((answer) => answer.quality)
          .map((answer) => [answer.providerId, answer.quality]),
      ),
    [answers],
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
          qualities={qualities}
          onSelectProvider={chooseProvider}
          nextEpisode={next}
          segments={segments}
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
