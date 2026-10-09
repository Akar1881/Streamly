'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import site from '@config/site';
import Icon from '@/components/ui/Icon';
import PlayerCenterControls from '@/components/player/PlayerCenterControls';
import PlayerControls, { volumeIcon } from '@/components/player/PlayerControls';
import CaptionsMenu from '@/components/player/CaptionsMenu';
import QualityMenu from '@/components/player/QualityMenu';
import SpeedMenu from '@/components/player/SpeedMenu';
import SubtitleSettingsPanel from '@/components/player/SubtitleSettingsPanel';
import SubtitleOverlay from '@/components/player/SubtitleOverlay';
import ProviderMenu from '@/components/player/ProviderMenu';
import { useTouchGestures } from '@/components/player/useTouchGestures';
import { attachSource } from '@/lib/player/source';
import { parseTrack } from '@/lib/player/cues';
import { defaultSettings, loadSettings, resetSettings, saveSettings } from '@/lib/player/settings';
import { clamp } from '@/lib/player/time';

/**
 * ============================================================================
 *  VIDEO PLAYER
 * ============================================================================
 *  The shell: one <video> element, the state of its playback, and the chrome
 *  around it. Everything below this file is either a control that reports a
 *  value or a helper that does not know about React at all.
 *
 *  It is deliberately **source-agnostic**. It takes URLs and MIME types, not a
 *  TMDB id, so the thing that finds streams — today a test page, later a scraper
 *  — only has to hand it a list. Nothing here knows what a movie is.
 *
 *  Three things are worth knowing before changing it:
 *
 *    - The element arrives as **state, not a ref** (`ref={setVideo}`). Every
 *      effect that touches playback depends on it, and a ref would not trigger
 *      them, so the first render would attach nothing and the player would stay
 *      black.
 *    - Cue text is rendered by `SubtitleOverlay`, not by a `<track>`, so that the
 *      appearance panel can style it. The consequence is that subtitles are
 *      absent inside Picture-in-Picture — that is explained in that file.
 *    - The keyboard is bound to the player box, not to the document. A second
 *      player, or a carousel elsewhere on the page, must not fight this one for
 *      the arrow keys.
 * ============================================================================
 */

/** How long the chrome stays up after the last interaction. */
const IDLE_MS = 2800;

/** How much a skip button moves. */
const SKIP_SECONDS = 10;

/** How often `onProgress` is reported, in seconds. */
const PROGRESS_EVERY = 5;

/** What a held pointer multiplies playback by, when "Hold for 2×" is on. */
const HOLD_RATE = 2;

/**
 * How long a press must last before it counts as a hold.
 *
 * The same gesture has to serve two meanings: a press and release is a click
 * that pauses, and a press held down is fast-forward. Waiting out a delay is
 * what separates them — without it every tap would raise the rate and would
 * also have to have its click thrown away, which would break tap-to-pause
 * exactly when the viewer had asked for the hold gesture.
 */
const HOLD_DELAY = 220;

/** The element a fullscreen request is made against. */
function fullscreenElement() {
  if (typeof document === 'undefined') return null;
  return document.fullscreenElement ?? null;
}

/**
 * @param {object} props
 * @param {{src: string, type?: string, label?: string, headers?: Record<string, string>}[]} props.sources  played in order; the first is used
 * @param {{src: string, label: string, hint?: string, default?: boolean}[]} [props.tracks]
 * @param {string}  [props.poster]
 * @param {string}  [props.title]        accessible name for the video
 * @param {boolean} [props.autoplay]
 * @param {number}  [props.startAt]      seconds to resume from
 * @param {(seconds: number, duration: number) => void} [props.onProgress]
 * @param {() => void} [props.onEnded]
 * @param {{id: string, label: string}[]} [props.providers]
 *        the sources this page can play from, for the source menu. Distinct
 *        from `sources` above, which is the *stream URLs* of whichever provider
 *        is current — one is where the picture comes from, the other is what is
 *        coming from it.
 * @param {string}  [props.providerId]      the one playing
 * @param {string[]} [props.unavailable]     provider ids that came back empty
 * @param {(id: string) => void} [props.onSelectProvider]
 */
export default function VideoPlayer({
  sources = [],
  tracks = [],
  poster,
  title,
  autoplay = false,
  startAt = 0,
  onProgress,
  onEnded,
  providers = [],
  providerId = null,
  unavailable = [],
  onSelectProvider,
}) {
  const containerRef = useRef(null);
  const sourceRef = useRef(null); // the live engine handle
  const idleTimer = useRef(0);
  const reported = useRef(0);
  const holdTimer = useRef(0); // the pending "this press is becoming a hold"
  const holdingRef = useRef(false); // a hold is live; see the rate guard in `sync`
  const baseRate = useRef(1); // the speed a hold returns to
  const holdClick = useRef(false); // swallow the click that ends a hold
  const touch = useRef(false); // the pointer in play is a finger, not a mouse
  const trackChosen = useRef(false); // the viewer picked a track, or turned them off
  const latestSource = useRef(null); // the source object, read when it is attached

  // --- the element, and what it is playing --------------------------------
  const [video, setVideo] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  /**
   * Whether holding the picture speeds the film up.
   *
   * On to begin with. It is the gesture people reach for without knowing it
   * exists — press the picture and it runs faster — and it is harmless when it
   * fires by accident, because a hold is only a hold after a quarter of a
   * second and it ends when the press does. The Speed menu turns it off for
   * anyone who would rather it did not.
   */
  const [hold, setHold] = useState(true);
  const [holding, setHolding] = useState(false); // drives the 2× badge
  const [started, setStarted] = useState(false); // the film has painted a frame
  const [brightness, setBrightness] = useState(1); // the drag-on-the-left gesture
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(null);

  // --- the chrome ---------------------------------------------------------
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState(null); // 'sources' | 'captions' | 'quality' | 'speed' | 'settings'
  const [hoveringBar, setHoveringBar] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrub, setScrub] = useState(null); // seconds while dragging the seek bar

  // --- the stream ---------------------------------------------------------
  const [engine, setEngine] = useState({ engine: 'direct', levels: [], current: -1, auto: true });

  // --- subtitles ----------------------------------------------------------
  const [settings, setSettings] = useState(defaultSettings);
  const [activeTrack, setActiveTrack] = useState(null);
  const [cues, setCues] = useState([]);
  const [delay, setDelay] = useState(0);

  const source = sources[0] ?? null;
  const sourceSrc = source?.src ?? null;
  const sourceType = source?.type;

  /* ---------------------------------------------------------------------- */
  /*  Playback                                                              */
  /* ---------------------------------------------------------------------- */

  // The source object, kept in a ref rather than listed as a dependency of the
  // effect below. A caller that builds `sources` inline hands over a new object
  // on every render, and treating that as a change would tear the stream down
  // and re-attach it mid-playback. The URL is what is keyed, because a source
  // change is exactly a URL change — the headers travel with it, not apart
  // from it. Declared before the attach effect so it has run by the time that
  // one reads it.
  useEffect(() => {
    latestSource.current = source;
  }, [source]);

  // Attaching is the one effect that must survive React running it twice in
  // development: `attachSource` is async internally, and `dispose` is written to
  // be safe before the engine has finished loading.
  useEffect(() => {
    if (!video || !sourceSrc) return undefined;

    const handle = attachSource(video, sourceSrc, {
      type: sourceType,
      headers: latestSource.current?.headers,
      onEngine: setEngine,
      onError: (cause) => setError(cause?.message ?? 'This stream could not be played.'),
    });

    sourceRef.current = handle;
    setError(null);
    // A different stream has not painted anything yet, so its poster goes back
    // up — otherwise switching source leaves the old film's last frame on
    // screen until the new one starts.
    setStarted(false);

    return () => {
      handle.dispose();
      sourceRef.current = null;
    };
  }, [video, sourceSrc, sourceType]);

  // Element events. One effect, because they all do the same thing: copy a
  // property of the element into the state the chrome renders from.
  useEffect(() => {
    if (!video) return undefined;

    const sync = () => {
      setPlaying(!video.paused && !video.ended);
      setTime(video.currentTime);
      setDuration(video.duration);
      setVolume(video.volume);
      setMuted(video.muted);
      // `rate` is the speed the viewer chose, not whatever the element is doing
      // this instant. A hold sets the element to 2× and fires `ratechange`; if
      // that were copied into state, the Speed menu would read "2×" for the rest
      // of the film and the effect that applies `rate` would put the film back
      // at double speed the moment the hold was released.
      if (!holdingRef.current) setRate(video.playbackRate);
    };

    const syncBuffered = () => {
      const ranges = video.buffered;
      if (!ranges.length) return;
      // The end of the last range: what has been downloaded furthest along.
      setBuffered(ranges.end(ranges.length - 1));
    };

    const onSeeked = () => {
      setScrub(null);
      sync();
    };

    const onWaiting = () => setBuffering(true);
    const onLive = () => setBuffering(false);

    // Deliberately its own handler rather than part of `onLive`: `canplay` says
    // the first frame is ready, `playing` says the film is actually running —
    // and the poster should come down on the second of those, not the first.
    const onStarted = () => {
      setBuffering(false);
      setStarted(true);
    };

    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    video.addEventListener('ended', sync);
    video.addEventListener('timeupdate', sync);
    video.addEventListener('durationchange', sync);
    video.addEventListener('loadedmetadata', sync);
    video.addEventListener('volumechange', sync);
    video.addEventListener('ratechange', sync);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('progress', syncBuffered);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onStarted);
    video.addEventListener('canplay', onLive);

    sync();

    return () => {
      video.removeEventListener('play', sync);
      video.removeEventListener('pause', sync);
      video.removeEventListener('ended', sync);
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('durationchange', sync);
      video.removeEventListener('loadedmetadata', sync);
      video.removeEventListener('volumechange', sync);
      video.removeEventListener('ratechange', sync);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('progress', syncBuffered);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onStarted);
      video.removeEventListener('canplay', onLive);
    };
  }, [video]);

  useEffect(() => {
    if (video) video.playbackRate = rate;
  }, [video, rate]);

  // Autoplay and resume. Browsers refuse an unmuted autoplay on a page the
  // visitor has not interacted with, so the attempt is allowed to fail quietly —
  // the large play button is already on screen, which is the right answer.
  useEffect(() => {
    if (!video) return undefined;

    const begin = () => {
      if (startAt > 0 && video.currentTime < 1) video.currentTime = startAt;
      if (autoplay) video.play().catch(() => {});
    };

    video.addEventListener('loadedmetadata', begin, { once: true });
    if (video.readyState >= 1) begin();

    return () => video.removeEventListener('loadedmetadata', begin);
  }, [video, autoplay, startAt]);

  useEffect(() => {
    if (video) video.volume = volume;
  }, [video, volume]);

  useEffect(() => {
    if (video) video.muted = muted;
  }, [video, muted]);

  // Report progress on a throttle. The page decides what to do with it; this
  // only guarantees it is not called on every `timeupdate`. The duration goes
  // with it because the page cannot otherwise tell a position worth returning
  // to from one that is two minutes short of the credits.
  useEffect(() => {
    if (!onProgress || !Number.isFinite(time)) return;
    if (Math.abs(time - reported.current) < PROGRESS_EVERY) return;
    reported.current = time;
    onProgress(time, duration);
  }, [time, duration, onProgress]);

  /* ---------------------------------------------------------------------- */
  /*  Subtitles                                                             */
  /* ---------------------------------------------------------------------- */

  // Appearance is read from storage after mount rather than during the first
  // render: the server has no localStorage, and a different value on the client's
  // first paint is a hydration mismatch.
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  // A track marked `default` turns itself on. That is how the translated
  // subtitle arrives already showing rather than waiting to be found in the
  // captions menu — but the list it has to be found in is not there yet when
  // the player mounts, because the translation lands a moment later, so the
  // list goes from empty to one and this has to survive that.
  //
  // Once the viewer has picked a track or turned captions off, that choice is
  // kept: a default track appearing afterwards must not switch them back on.
  useEffect(() => {
    if (trackChosen.current || !tracks.length) return;
    const preferred = tracks.findIndex((track) => track.default);
    if (preferred >= 0) setActiveTrack(preferred);
  }, [tracks]);

  // Load and parse the chosen track. Parsed once per track, not per cue — the
  // overlay searches the resulting array on every frame instead.
  //
  // Keyed on the URL rather than on the `tracks` array, so a caller passing an
  // array literal on every render cannot make this refetch the same file
  // forever.
  const trackSrc = activeTrack === null ? null : (tracks[activeTrack]?.src ?? null);

  useEffect(() => {
    if (!trackSrc) {
      setCues([]);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    fetch(trackSrc, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Subtitle failed (${response.status})`);
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setCues(parseTrack(text));
      })
      .catch((cause) => {
        if (cancelled || cause?.name === 'AbortError') return;
        setCues([]);
        setActiveTrack(null);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [trackSrc]);

  const patchSettings = useCallback((patch) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const doReset = useCallback(() => setSettings(resetSettings()), []);

  /* ---------------------------------------------------------------------- */
  /*  Chrome                                                                */
  /* ---------------------------------------------------------------------- */

  const wake = useCallback(() => {
    setVisible(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setVisible(false), IDLE_MS);
  }, []);

  // The timer stops whenever hiding would be wrong — while paused, while a menu
  // is open, and while the pointer is on the bar. Hiding a menu somebody is
  // reading is the classic version of this bug.
  useEffect(() => {
    const held = !playing || menu !== null || hoveringBar || buffering;

    if (held) {
      window.clearTimeout(idleTimer.current);
      setVisible(true);
      return undefined;
    }

    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [playing, menu, hoveringBar, buffering, wake]);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(Boolean(fullscreenElement()));
      // A fullscreen transition moves focus, and where it lands is the
      // browser's business — it has differed between browsers and between
      // versions of the same one. The shortcuts are bound to the container, so
      // rather than depend on the answer the player takes focus back itself.
      // Cheap, silent (the container is `outline-none`) and right either way,
      // since it is the only place a fullscreen visitor can type into.
      containerRef.current?.focus({ preventScroll: true });
    };

    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The shortcuts are bound to the container, so they reach it only while focus
  // is inside it. Choosing an item from a menu is the other way focus leaves:
  // the menu closes, the row that was clicked goes with it, and when the focused
  // element is removed the browser drops focus on the body — after which every
  // shortcut does nothing until the viewer clicks the picture, which works only
  // because that focusable container is the nearest focusable ancestor of the
  // click. So the player puts focus back itself.
  //
  // Only when it has actually escaped, so that a click on a control is not
  // undone a frame later, and `preventScroll` because a control can be focused
  // from a click on a page scrolled anywhere.
  useEffect(() => {
    const owner = containerRef.current;
    if (!owner) return;

    const active = document.activeElement;
    if (active === null || active === document.body) owner.focus({ preventScroll: true });
  }, [menu]);

  /* ---------------------------------------------------------------------- */
  /*  Actions                                                               */
  /* ---------------------------------------------------------------------- */

  const togglePlay = useCallback(() => {
    if (!video) return;
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  }, [video]);

  const skip = useCallback(
    (seconds) => {
      if (!video) return;
      const total = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = clamp(video.currentTime + seconds, 0, total || Number.MAX_SAFE_INTEGER);
      setTime(video.currentTime);
    },
    [video],
  );

  // While dragging, the time is only previewed — the decoder is not asked to
  // fetch a new position on every pointer move, which is what makes a drag
  // stutter on a stream that has to re-buffer.
  const seek = useCallback(
    (seconds, final) => {
      if (!video) return;
      if (final) {
        video.currentTime = seconds;
        setScrub(null);
      } else {
        setScrub(seconds);
      }
    },
    [video],
  );

  const toggleMute = useCallback(() => setMuted((current) => !current), []);

  /** One place for "the volume went up", whichever gesture or control did it. */
  const changeVolume = useCallback((next) => {
    setVolume(next);
    if (next > 0) setMuted(false);
  }, []);

  /**
   * A single tap on the picture, for a finger.
   *
   * It shows and hides the chrome rather than starting and stopping the film —
   * which is what a mouse click does — because on a finger the tap has to share
   * its gesture with the double tap that skips, and the second tap can only be
   * waited for by making the first one do nothing in the meantime. Waiting
   * before revealing the controls is unremarkable; waiting before obeying a
   * "pause" is not.
   */
  const toggleControls = useCallback(() => {
    if (visible) {
      window.clearTimeout(idleTimer.current);
      setVisible(false);
    } else {
      wake();
    }
  }, [visible, wake]);

  const gestures = useTouchGestures({
    fullscreen,
    holdEnabled: hold,
    skipSeconds: SKIP_SECONDS,
    volume,
    brightness,
    onSkip: skip,
    onVolume: changeVolume,
    onBrightness: setBrightness,
    onControls: toggleControls,
    onHoldStart: holdStart,
    onHoldEnd: holdEnd,
  });

  /**
   * Everything the picture does in response to a pointer.
   *
   * Two gestures share these events — the mouse holds for 2×, a finger taps,
   * drags and double-taps — and they cannot be two handler objects on the same
   * element, because React takes one prop per event. So they are told apart by
   * pointer type here, and each is handed only the events that are its own.
   */
  function pointerHandlers() {
    const mouse = holdHandlers();

    return {
      onPointerDown: (event) => {
        touch.current = event.pointerType === 'touch';
        if (touch.current) {
          gestures.down(event);
          return;
        }
        mouse.onPointerDown?.(event);
      },
      onPointerMove: (event) => {
        if (event.pointerType === 'touch') gestures.move(event);
      },
      onPointerUp: (event) => {
        if (event.pointerType === 'touch') {
          gestures.up(event);
          return;
        }
        mouse.onPointerUp?.(event);
      },
      onPointerLeave: (event) => {
        if (event.pointerType !== 'touch') mouse.onPointerLeave?.(event);
      },
      onPointerCancel: (event) => {
        if (event.pointerType === 'touch') gestures.cancel(event);
      },
    };
  }

  const toggleFullscreen = useCallback(() => {
    const box = containerRef.current;
    if (!box) return;

    if (fullscreenElement()) document.exitFullscreen().catch(() => {});
    else box.requestFullscreen?.().catch(() => {});
  }, []);

  const togglePip = useCallback(() => {
    if (!video || typeof document === 'undefined') return;

    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else video.requestPictureInPicture?.().catch(() => {});
  }, [video]);

  /**
   * A double click on the picture.
   *
   * Ignored for a finger, where the same gesture is a skip — fullscreening the
   * film because someone wanted to jump ten seconds forward is the kind of
   * surprise that makes a player feel broken.
   */
  const onSurfaceDoubleClick = useCallback(() => {
    if (touch.current) return;
    toggleFullscreen();
  }, [toggleFullscreen]);

  // Asked for after mount rather than read during render. `document` does not
  // exist on the server, so reading it here would render no button on the server
  // and a button on the client, and React would throw the whole subtree away as
  // a hydration mismatch — which is what it was doing.
  const [pipSupported, setPipSupported] = useState(false);
  useEffect(() => {
    setPipSupported(document.pictureInPictureEnabled === true);
  }, []);

  // A press that was still waiting out HOLD_DELAY when the player went away.
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  /** A click on the picture: close a menu, or start and stop the film. */
  const onSurfaceClick = useCallback(() => {
    // A finger's tap is the gesture layer's business, not a click. It arrives
    // here too — a tap fires one — but by then `useTouchGestures` has already
    // decided whether it was a tap, a double tap or a drag, and a second opinion
    // from the mouse path would start the film every time someone skipped.
    if (touch.current) return;
    // The click that ends a hold is not a request to pause.
    if (holdClick.current) {
      holdClick.current = false;
      return;
    }
    if (menu) {
      setMenu(null);
      return;
    }
    togglePlay();
  }, [menu, togglePlay]);

  /* ---------------------------------------------------------------------- */
  /*  Keyboard                                                              */
  /* ---------------------------------------------------------------------- */

  function onKeyDown(event) {
    // Never while the viewer is typing, and never for a modified key — those
    // belong to the browser or the operating system.
    const target = event.target;
    if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const jump = (seconds) => {
      event.preventDefault();
      skip(seconds);
    };

    switch (event.key) {
      case ' ':
      case 'k':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        jump(SKIP_SECONDS / 2);
        break;
      case 'ArrowLeft':
        jump(-SKIP_SECONDS / 2);
        break;
      case 'l':
        jump(SKIP_SECONDS);
        break;
      case 'j':
        jump(-SKIP_SECONDS);
        break;
      case 'ArrowUp':
        event.preventDefault();
        changeVolume(clamp(volume + 0.1, 0, 1));
        break;
      case 'ArrowDown':
        event.preventDefault();
        changeVolume(clamp(volume - 0.1, 0, 1));
        break;
      case 'm':
        toggleMute();
        break;
      case 'f':
        toggleFullscreen();
        break;
      case 'c':
        // Cycle: off, then each track, then off again.
        trackChosen.current = true;
        setActiveTrack((current) => {
          if (current === null) return tracks.length ? 0 : null;
          return current + 1 < tracks.length ? current + 1 : null;
        });
        break;
      case 'Escape':
        setMenu(null);
        break;
      default:
        // 0-9 seek to that tenth of the film.
        if (/^[0-9]$/.test(event.key) && Number.isFinite(duration) && duration > 0) {
          event.preventDefault();
          seek((Number(event.key) / 10) * duration, true);
        }
    }

    wake();
  }

  /* ---------------------------------------------------------------------- */
  /*  Derived                                                               */
  /* ---------------------------------------------------------------------- */

  const shownTime = scrub ?? time;

  const qualityLabel = useMemo(() => {
    if (!engine.levels.length) return 'Auto';
    if (engine.auto) return 'Auto';
    return engine.levels.find((level) => level.index === engine.current)?.label ?? 'Auto';
  }, [engine]);

  const speedLabel = rate === 1 ? 'Speed' : `${rate}×`;

  // The captions button names the track that is on rather than saying
  // "Captions". Which subtitle is playing is the one thing the bar cannot show
  // any other way — the icon says only that something is on — and on this site
  // it is a question with a real answer, because two tracks ship and they are
  // not interchangeable. Off, or a stream with no tracks, keeps the plain word.
  //
  // Read off `tracks[activeTrack]` rather than off a second piece of state, so
  // it cannot disagree with the list the captions menu is showing.
  const captionsLabel = (activeTrack === null ? null : tracks[activeTrack]?.label) ?? 'Captions';

  /** Raises the rate for a hold, remembering what to come back to. */
  function holdStart() {
    if (!video || holdingRef.current) return;
    holdingRef.current = true;
    baseRate.current = video.playbackRate;
    video.playbackRate = HOLD_RATE;
    setHolding(true);
  }

  /** Drops the rate back. Says whether a hold was actually live. */
  function holdEnd() {
    if (!holdingRef.current) return false;
    holdingRef.current = false;
    setHolding(false);
    // Restoring from the ref, not from `rate`: the rate the viewer can see is
    // the rate this hold was layered on top of, and it is the only value that
    // is right to come back to.
    if (video) video.playbackRate = baseRate.current;
    return true;
  }

  /** A held pointer on the picture, when the viewer asked for that gesture. */
  function holdHandlers() {
    if (!hold) return {};

    const stop = (swallowClick) => () => {
      window.clearTimeout(holdTimer.current);
      // A press and release is also a click. Left alone, that click lands on the
      // surface below and pauses the film — which is what releasing a hold used
      // to do.
      if (holdEnd() && swallowClick) holdClick.current = true;
    };

    return {
      onPointerDown: () => {
        if (!video) return;
        window.clearTimeout(holdTimer.current);
        holdTimer.current = window.setTimeout(holdStart, HOLD_DELAY);
      },
      onPointerUp: stop(true),
      // Restoring on `pointerleave` as well as `pointerup` covers a pointer that
      // leaves the frame mid-hold — otherwise the film stays at double speed with
      // nothing held down, which is the one way this gesture can strand a viewer.
      // No click follows it, so there is nothing to swallow.
      onPointerLeave: stop(false),
    };
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      // A mouse crossing the picture is on its way to the controls, so it brings
      // them up. A finger is not: inline it is scrolling the page past the
      // player, and one passing over on its way down the page has asked for
      // nothing — a finger that wants the chrome taps, which works in either
      // mode. Without this, letting the page scroll over the player (see the
      // gesture surface below) would flash the bar on every scroll past it.
      onPointerMove={(event) => {
        if (event.pointerType !== 'touch') wake();
      }}
      // The browser's own menu over a player offers "Save video as…", "Cast…"
      // and "Picture in picture" against an `<video>` that is one segment of a
      // stream, so every entry in it either does nothing or downloads a
      // fragment. Suppressed over the whole player rather than the `<video>`
      // alone, because most of what is on show here is not the element: the
      // gesture surface sits over it, and a right-click there was reaching the
      // page behind.
      onContextMenu={(event) => event.preventDefault()}
      aria-label={title ? `${title} player` : 'Video player'}
      // Fullscreen drops the border and the rounded corners. The element is the
      // whole screen there, so the corner it is cut off at leaves a bright arc
      // of `border-line` against the black — four of them, which reads as a bug
      // rather than as a design.
      // `select-none` as well as the context menu: a press held on a touch
      // screen starts a text selection and, on iOS, the callout that goes with
      // it — both of which arrive before the hold gesture has had its quarter of
      // a second, and both of which look like the player reacting to a press by
      // doing nothing.
      //
      // The pointer goes with the chrome. A cursor floating over a picture with
      // nothing to click is the same small lie as the bar still being there, and
      // it is the more visible of the two on a dark frame. It comes back with
      // the chrome, because anything that brings the bar back — a move, a key, a
      // tap — wakes this first. `visible` is already the whole question: the
      // player holds it true while paused, while a menu is open and while
      // buffering, so a pointer that is about to be needed is never hidden.
      className={`relative aspect-video w-full select-none overflow-hidden bg-black outline-none
        ${visible ? '' : 'cursor-none'}
        ${fullscreen ? '' : 'rounded-[var(--radius-card)] border border-line'}`}
    >
      <video
        ref={setVideo}
        playsInline
        preload="metadata"
        title={title}
        onEnded={onEnded}
        // Dimming the picture itself, not the frame around it: the subtitles are
        // drawn over this element rather than in it, so they stay at full
        // contrast — which is the point of dimming a bright scene in the dark.
        style={brightness < 1 ? { filter: `brightness(${brightness})` } : undefined}
        className="absolute inset-0 size-full bg-black object-contain"
      >
        {/* A subtitle track is deliberately absent — see SubtitleOverlay. */}
      </video>

      {/* The poster, drawn here rather than handed to the element as `poster`.
          An element draws its poster with the video's own `object-fit`, and that
          is `contain` — right for the picture, since cropping a 4:3 stream to
          fill a 16:9 frame would cut the top and bottom off the shot, but wrong
          for a poster, which on this site is portrait box art and ends up a
          narrow strip between two wide black bars. As its own image it can be
          fitted with `cover`, which fills the frame whatever shape it is.
          Taken down once the film has painted a frame — see `onStarted`. */}
      {poster && !started && (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
      )}

      {cues.length > 0 && (
        <SubtitleOverlay video={video} cues={cues} delay={delay} settings={settings} />
      )}

      {/* The gesture surface: under the chrome, over the picture.
          `touch-action` follows the one question that decides whether a finger
          on the picture belongs to the player or to the page. Fullscreen there
          is no page left to scroll, so `touch-none` takes the vertical drag for
          the volume and brightness — see `useTouchGestures`. Inline the page is
          the thing under the finger, and claiming the drag there is what turned
          an ordinary scroll into a volume change, so only vertical panning is
          left: the gesture layer ignores a press that travels, and the browser
          scrolls instead. `pan-y` rather than `auto` also keeps the browser's
          double-tap zoom away from a picture that has its own double tap. */}
      <div
        className={`absolute inset-0 z-10 ${fullscreen ? 'touch-none' : 'touch-pan-y'}`}
        onClick={onSurfaceClick}
        onDoubleClick={onSurfaceDoubleClick}
        {...pointerHandlers()}
      />

      {/* The hold gesture is silent otherwise — the film speeds up but nothing
          on screen says why, and the viewer has no way to tell a hold that
          worked from one they did not press hard enough. */}
      {holding && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
          <span
            role="status"
            className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm
              font-medium text-white backdrop-blur-sm"
          >
            <Icon name="zap" size={15} />
            {HOLD_RATE}× Speed
          </span>
        </div>
      )}

      {gestures.hud?.kind === 'skip' && (
        <div
          className={`pointer-events-none absolute inset-y-0 z-30 flex w-2/5 items-center
            ${gestures.hud.side === 'left' ? 'left-0 justify-start pl-[7%]' : 'right-0 justify-end pr-[7%]'}`}
        >
          <span
            className="flex size-16 flex-col items-center justify-center rounded-full
              bg-white/15 text-white backdrop-blur-sm"
          >
            <Icon name={gestures.hud.side === 'left' ? 'rotate-ccw' : 'rotate-cw'} size={26} />
            <span className="text-[10px] font-medium tabular-nums">{SKIP_SECONDS}s</span>
          </span>
        </div>
      )}

      {(gestures.hud?.kind === 'volume' || gestures.hud?.kind === 'brightness') && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
          <span
            role="status"
            className="flex items-center gap-2 rounded-full bg-black/70 px-3.5 py-2 text-sm
              font-medium text-white backdrop-blur-sm"
          >
            <Icon
              name={
                gestures.hud.kind === 'volume'
                  ? volumeIcon(muted, gestures.hud.value)
                  : 'sun'
              }
              size={16}
            />
            <span className="tabular-nums">{Math.round(gestures.hud.value * 100)}%</span>
          </span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/85 px-6 text-center">
          <div className="max-w-sm">
            <Icon name="alert-circle" size={26} className="mx-auto text-white/70" />
            <p className="mt-2 text-sm font-medium text-white">
              {/* Whether the film ever played decides which of the two this is,
                  and they are not interchangeable: "it stopped" tells a viewer
                  to wait for it to come back, which is the wrong advice when the
                  source refused the very first request. */}
              {started
                ? site.player.unavailable.dropped.title
                : site.player.unavailable.blocked.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/60">
              {started
                ? site.player.unavailable.dropped.body
                : site.player.unavailable.blocked.body}
            </p>

            <a
              href={site.player.unavailable.channel.href}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)]
                border border-white/25 px-3 py-1.5 text-xs text-white/80 transition-colors
                hover:text-white"
            >
              <Icon name="send" size={13} />
              {site.player.unavailable.channel.label}
            </a>

            {/* The engine's own words, kept for whoever has to work out why.
                Small and dim: it is a fault message, not something to read. */}
            <p className="mt-3 text-[10px] leading-relaxed text-white/30">{error}</p>
          </div>
        </div>
      )}

      <PlayerCenterControls
        playing={playing}
        onTogglePlay={togglePlay}
        onSkip={skip}
        visible={visible || !playing}
        buffering={buffering}
      />

      <PlayerControls
        playing={playing}
        currentTime={shownTime}
        duration={duration}
        buffered={buffered}
        onSeek={seek}
        volume={volume}
        muted={muted}
        onVolume={changeVolume}
        onToggleMute={toggleMute}
        captionsOn={activeTrack !== null}
        captionsLabel={captionsLabel}
        showSources={providers.length > 1}
        sourceLabel={providers.find((provider) => provider.id === providerId)?.label ?? 'Source'}
        openMenu={menu}
        onOpenMenu={setMenu}
        qualityLabel={qualityLabel}
        speedLabel={speedLabel}
        pipSupported={pipSupported}
        onTogglePip={togglePip}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        visible={visible}
        onHover={setHoveringBar}
      />

      {menu === 'sources' && (
        <ProviderMenu
          providers={providers}
          providerId={providerId}
          unavailable={unavailable}
          onSelect={(id) => {
            onSelectProvider?.(id);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {menu === 'captions' && (
        <CaptionsMenu
          tracks={tracks}
          activeTrack={activeTrack}
          onSelectTrack={(index) => {
            trackChosen.current = true;
            setActiveTrack(index);
            setMenu(null);
          }}
          delay={delay}
          onDelay={setDelay}
          onCustomize={() => setMenu('settings')}
          onClose={() => setMenu(null)}
        />
      )}

      {menu === 'settings' && (
        <SubtitleSettingsPanel
          settings={settings}
          onChange={patchSettings}
          onReset={doReset}
          onBack={() => setMenu('captions')}
          onClose={() => setMenu(null)}
        />
      )}

      {menu === 'quality' && (
        <QualityMenu
          levels={engine.levels}
          auto={engine.auto}
          current={engine.current}
          engine={engine.engine}
          onSelect={(index) => {
            sourceRef.current?.setLevel(index);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {menu === 'speed' && (
        <SpeedMenu
          rate={rate}
          onRate={(next) => {
            setRate(next);
            setMenu(null);
          }}
          hold={hold}
          onHold={setHold}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
