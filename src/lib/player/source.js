/**
 * ============================================================================
 *  PLAYER — choosing a playback engine
 * ============================================================================
 *  Everything that knows the difference between a `.m3u8` and an `.mp4` is in
 *  this file, and the component above it only ever calls `attachSource`.
 *
 *  Three engines, tried in this order:
 *
 *    1. Native HLS. Safari and every iOS browser play HLS themselves. Handing
 *       them the URL is better than shimming a decoder in JavaScript, and on
 *       iOS it is the only option — MSE does not exist there.
 *    2. hls.js. Chrome, Firefox and Edge have no native HLS, but every one of
 *       them has Media Source Extensions, which is all hls.js needs.
 *    3. Direct. An mp4, or any file the browser can already play.
 *
 *  Only the second one is imported, and only when it is needed: `import()` here
 *  is what keeps ~300 KB of segment parser out of every page that never plays an
 *  HLS stream.
 *
 *  It also owns failure. A fatal hls.js error is not the end — the library
 *  distinguishes a network hiccup from a decode failure and has a specific
 *  recovery for each, so both are retried a bounded number of times before the
 *  player gives up and says so.
 * ============================================================================
 */

/** hls.js needs a Media Source. No MSE, no hls.js. */
const MSE = 'MediaSource' in globalThis;

/** How many times a fatal error is retried before the player admits defeat. */
const MAX_RECOVERIES = 3;

/** How often the rung in hand is reconsidered once it has been stepped down. */
const RECHECK_MS = 8000;

/** How much buffer ahead of the playhead is enough to try the next rung up. */
const HEALTHY_BUFFER = 45;

/** How far under the estimate the next rung's bitrate must be to climb to it. */
const CLIMB_MARGIN = 1.3;

/** How long after stepping down before another step down is allowed. */
const DROP_COOLDOWN_MS = 5000;

/** How much film is downloaded and waiting, ahead of where the viewer is. */
function bufferedAhead(video) {
  const { buffered, currentTime } = video;

  for (let index = 0; index < buffered.length; index += 1) {
    if (currentTime >= buffered.start(index) && currentTime <= buffered.end(index)) {
      return buffered.end(index) - currentTime;
    }
  }

  return 0;
}

/** Whether a source is an HLS playlist, from its declared type or its URL. */
function isHls(src, type) {
  if (type) return /mpegurl/i.test(type);
  return /\.m3u8(\?|#|$)/i.test(String(src ?? ''));
}

function supportsNativeHls(video) {
  if (!video.canPlayType('application/vnd.apple.mpegurl')) return false;

  const userAgent = globalThis.navigator?.userAgent ?? '';
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)/i.test(userAgent);
  return isIOS || isSafari;
}

/** A level, flattened to what the quality menu actually needs. */
function readLevel(level, index) {
  const height = level?.height || 0;
  return {
    index,
    height,
    bitrate: level?.bitrate ?? 0,
    label: height ? `${height}p` : `${Math.round((level?.bitrate ?? 0) / 1000)}k`,
  };
}

/**
 * The audio renditions an hls.js instance found, and the one it is playing.
 *
 * `audioTracks` is the set belonging to the level being watched, so it is read
 * again whenever that set changes and whenever a switch lands.
 *
 * `id` is carried rather than the array position, because it is what the
 * engine's setter takes and what it names in its events. For hls.js the two are
 * the same number — it numbers its renditions per group — but the menu should
 * not have to know that.
 *
 * `audioTrack` is `-1` until the first switch has completed, which is a moment
 * after the list arrives. The manifest's own default is reported in the
 * meantime — or the first rendition, when nothing claims to be the default —
 * because that is the one hls.js is about to select, and a menu that marks
 * nothing for the first second is wrong rather than merely early.
 */
function readAudioTracks(hls) {
  const list = hls.audioTracks ?? [];

  const tracks = list.map((track, index) => ({
    id: track.id ?? index,
    label: track.name || track.lang || `Track ${index + 1}`,
  }));

  if (hls.audioTrack >= 0) return { tracks, current: hls.audioTrack };

  const fallback = tracks.find((_track, index) => list[index].default) ?? tracks[0];
  return { tracks, current: fallback ? fallback.id : -1 };
}

/**
 * The element's own audio renditions, for the browsers that expose them.
 *
 * Safari puts `audioTracks` on the element — a list of `{ label, language,
 * enabled }` that is switched by toggling `enabled` — and it is the only way to
 * reach a second audio track in an MP4 or a MOV, which is a thing the container
 * supports and hls.js has nothing to do with. It is also how Safari's own HLS
 * player is switched, which the native engine above hands the URL to.
 *
 * Firefox has the property but never the renditions, and Chrome has neither: on
 * those `list` is missing or empty, this reports nothing, and the button stays
 * away. There is no shim for that — the tracks are inside the file, and the
 * decoder is the only thing that can reach them.
 *
 * @returns {{dispose: () => void, select: (id: number) => void}|null}
 */
function attachElementAudio(video, onAudio) {
  const list = video.audioTracks;
  if (!list) return null;

  /** The list, and which of it is on, in the shape the menu takes. */
  const read = () => {
    const tracks = [];
    let current = -1;

    for (let index = 0; index < list.length; index += 1) {
      const track = list[index];
      tracks.push({
        id: index,
        label: track.label || track.language || `Track ${index + 1}`,
      });
      if (track.enabled) current = index;
    }

    onAudio?.({ tracks, current });
  };

  // Read on `loadedmetadata` rather than only here: an element has no tracks
  // until it has read the file's header, and for anything handed over through a
  // manifest the list arrives later still.
  video.addEventListener('loadedmetadata', read);
  list.addEventListener?.('change', read);
  read();

  return {
    select(id) {
      for (let index = 0; index < list.length; index += 1) {
        list[index].enabled = index === id;
      }
    },
    dispose() {
      video.removeEventListener('loadedmetadata', read);
      list.removeEventListener?.('change', read);
    },
  };
}

/**
 * A source's headers, in the two shapes hls.js asks for them.
 *
 * hls.js may load through XMLHttpRequest or through fetch depending on the
 * build, and each takes headers through its own hook — so both are set and
 * whichever loader runs gets them. hls.js calls these for the manifest and for
 * every segment, which is what a source gating on a header needs.
 *
 * It is worth being blunt about the limit, because it is the browser's and not
 * something more code can fix: `setRequestHeader` and `fetch` silently drop
 * **forbidden header names** — `Referer`, `Origin`, `User-Agent`, `Cookie`,
 * `Host` and a short list of others — because the browser sets those itself and
 * will not let a page forge them. A source that only works when the request
 * carries one of those cannot be played from a browser at all; it needs a
 * server-side proxy, which is deliberately not what this is.
 *
 * What does work is anything the server treats as an ordinary credential:
 * `Authorization`, a signed token, a custom `X-…` header. That is the case this
 * exists for.
 */
function headerConfig(headers) {
  const entries = Object.entries(headers ?? {}).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (!entries.length) return {};

  return {
    xhrSetup: (xhr) => {
      for (const [name, value] of entries) xhr.setRequestHeader(name, String(value));
    },
    fetchSetup: (_context, initParams) => ({
      ...initParams,
      headers: {
        ...(initParams?.headers ?? {}),
        ...Object.fromEntries(entries.map(([name, value]) => [name, String(value)])),
      },
    }),
  };
}

/**
 * Plays `src` in `video`, reporting what it finds through `handlers`.
 *
 * @param {HTMLVideoElement} video
 * @param {string} src
 * @param {object}   [handlers]
 * @param {string}   [handlers.type]      the source's MIME type, if known
 * @param {Record<string, string>} [handlers.headers]
 *        headers the source's host expects. Honoured by the hls.js engine only,
 *        and only for names the browser lets a page set — see `headerConfig`.
 * @param {(state: {engine: string, levels: object[]|null, current: number, auto: boolean}) => void} [handlers.onEngine]
 *        called once the engine is chosen and again whenever its levels or the
 *        active level change. `levels` is `null` until a manifest has been read,
 *        and `[]` when the engine has none to offer.
 * @param {(audio: {tracks: {id: number, label: string}[], current: number}) => void} [handlers.onAudio]
 *        called with the audio renditions the stream carries and the `id` of
 *        the one playing, or `-1` for none. Reported once on attach as empty,
 *        so a list left over from the last source cannot outlive it, then again
 *        whenever either changes. Empty on engines with nothing to choose —
 *        which is most of them; see `attachElementAudio`.
 * @param {(error: Error) => void} [handlers.onError]
 * @returns {{ dispose: () => void, setLevel: (index: number|null) => void, setAudioTrack: (id: number) => void }}
 */
export function attachSource(video, src, { type, headers, onEngine, onAudio, onError } = {}) {
  let disposed = false;
  let hls = null;
  let elementAudio = null;
  let recoveries = 0;
  let levels = [];
  let current = -1;

  /**
   * The rung being aimed for, and whether the viewer aimed it.
   *
   * `wanted` is `-1` while the engine is choosing for itself, which is what the
   * quality menu's Auto writes. It is the top rung otherwise — pinned by the
   * manifest handler by default, or by the viewer from the menu.
   *
   * `chosen` records *who* pinned it. The default pin is ours and we may walk it
   * down and back up as the connection proves itself; a rung the viewer picked
   * is theirs, and a player that quietly overrode it would be a player whose
   * quality menu lies.
   */
  let wanted = -1;
  let chosen = false;

  /** The rung-rechecking timer, and when the last step down happened. */
  let guard = 0;
  let lastDrop = 0;

  const report = (engine) => {
    if (disposed) return;
    onEngine?.({ engine, levels, current, auto: current === -1 });
  };

  /** Undoes everything this call did. Safe to call twice, and from anywhere. */
  function dispose() {
    disposed = true;

    clearInterval(guard);
    guard = 0;

    if (hls) {
      // `destroy()`, not `detachMedia()`. Detaching leaves the loader running —
      // still fetching segments for a video element nobody is watching.
      hls.destroy();
      hls = null;
    }

    elementAudio?.dispose();
    elementAudio = null;

    // An hls.js instance sets `src` to a blob URL it owns; clearing it stops a
    // direct source from continuing to download in the background after a
    // source change.
    video.removeAttribute('src');
    video.load();
  }

  /**
   * A manual level, or `null` for automatic. A no-op on engines without levels.
   *
   * This is the viewer taking the wheel, so `chosen` goes up here and the
   * automatic step-down below stands down for the rest of the source. Picking
   * Auto hands the rung back to hls.js entirely, which is the one case where
   * `wanted` is not a rung at all.
   */
  function setLevel(index) {
    if (!hls || disposed) return;
    chosen = true;
    wanted = index === null ? -1 : index;
    hls.currentLevel = wanted;
  }

  /** A manual audio rendition. A no-op on engines with nothing to choose. */
  function setAudioTrack(id) {
    if (disposed) return;
    if (hls) hls.audioTrack = id;
    else elementAudio?.select(id);
  }

  if (!src) return { dispose, setLevel, setAudioTrack };

  // Neither engine has read anything yet, and the list from the last source
  // must not be left on screen — its menu would be offering a switch that now
  // leads nowhere.
  onAudio?.({ tracks: [], current: -1 });

  if (!isHls(src, type)) {
    // An mp4, or anything else the browser can play on its own. An MP4 can
    // still carry a second audio track, so the element is asked before the
    // engine is declared to have nothing.
    video.src = src;
    elementAudio = attachElementAudio(video, onAudio);
    onEngine?.({ engine: 'direct', levels: [], current: -1, auto: true });
    return { dispose, setLevel, setAudioTrack };
  }

  // --- native HLS ---------------------------------------------------------
  // Safari reports 'maybe' or 'probably'; everything else reports ''. The check
  // is deliberately before the hls.js branch, because on iOS hls.js is not an
  // option and on Safari the native path is the better one.
  if (supportsNativeHls(video)) {
    video.src = src;
    elementAudio = attachElementAudio(video, onAudio);
    onEngine?.({ engine: 'native', levels: [], current: -1, auto: true });
    return { dispose, setLevel, setAudioTrack };
  }

  if (!MSE) {
    onError?.(new Error('This browser cannot play HLS.'));
    return { dispose, setLevel, setAudioTrack };
  }

  // --- hls.js -------------------------------------------------------------
  import('hls.js')
    .then(({ default: Hls }) => {
      // The component may have changed source, or unmounted, while the chunk
      // was in flight. Creating an instance now would attach a loader nothing
      // will ever dispose.
      if (disposed) return;

      if (!Hls.isSupported()) {
        onError?.(new Error('This browser cannot play HLS.'));
        return;
      }

      hls = new Hls({
        // The ladder is entered at the top. `-1` leaves the first pick to the
        // estimator only until the manifest arrives, at which point the level is
        // pinned by hand below — see the comment there for why it is not left to
        // `startLevel`.
        startLevel: -1,
        // Roomier than the default, because a pinned top rendition has no lower
        // level to fall back to on the next bandwidth sample: without a cushion
        // of already-downloaded film in front of the playhead, one dip is a
        // stall rather than a quiet downgrade. The cushion also buys the
        // step-down below the seconds it needs to notice and react.
        //
        // The engine reads these three through one rule
        // (`base-stream-controller.getMaxBufferLength`):
        //
        //     min( max(8 * maxBufferSize / bitrate, maxBufferLength),
        //          maxMaxBufferLength )
        //
        // so the size is entered in *bits* against the rung's bitrate and only
        // ever raises the target — it cannot cap `maxBufferLength`, which is the
        // opposite of what its name suggests. `maxBufferLength` is therefore the
        // real knob at 4K, where a size-derived term of ~64s loses to it, and
        // `maxMaxBufferLength` is what stops the size term from running away at
        // the bottom of a ladder, where the same arithmetic yields minutes.
        //
        // Net effect: ninety seconds of run-up at the very least, three minutes
        // at most. In bytes that is at its steepest at the top of the ladder —
        // ninety seconds of 4K is near 280 MB — and it falls away with the
        // bitrate, because the size term is what sets the depth below about
        // 18 Mbps and 200 MB is what it is asked to hold.
        maxBufferLength: 90,
        maxMaxBufferLength: 300,
        maxBufferSize: 200 * 1000 * 1000,
        enableWorker: true,
        ...headerConfig(headers),
      });

      /** The renditions and the one playing, read off the instance. */
      const reportAudio = () => {
        if (!disposed) onAudio?.(readAudioTracks(hls));
      };

      /**
       * One rung down, because the one in hand has just proven it cannot be
       * delivered.
       *
       * Only ever called on a stall — evidence, rather than a guess from the
       * bandwidth estimate, which is at its least trustworthy in the seconds
       * after a stall has skewed it. Nothing else in this file is allowed to
       * move the rung downwards.
       *
       * The cooldown is for the case a stall snowballs: playback stops, the
       * level switch is requested, and the next stall report arrives from the
       * same episode before the switch has landed. Without it the ladder
       * collapses to the bottom rung over a bad ten seconds.
       */
      function stepDown() {
        if (chosen || wanted < 0 || current <= 0) return;

        const now = performance.now();
        if (now - lastDrop < DROP_COOLDOWN_MS) return;
        lastDrop = now;

        hls.currentLevel = current - 1;
      }

      /**
       * Gives the default pin a rung back, once the connection looks able to
       * carry it.
       *
       * The counterpart to `stepDown`, and deliberately much more reluctant than
       * it. Two conditions, both of which have to hold: real film already
       * downloaded and waiting *and* an estimate clear of what the next rung
       * costs. Either one alone is how a ladder oscillates — a full buffer on
       * its own says only that the download kept up while nothing was being
       * played, and a flattering estimate on its own is what the last stall
       * taught us not to trust.
       *
       * It climbs one rung at a time and re-checks on a timer, so a connection
       * that settles down half way up is caught there rather than made to stall
       * its way back to the floor.
       */
      function retune() {
        if (disposed || !hls || chosen || wanted < 0) return;
        // Nothing is being watched, so nothing is draining: a buffer that looks
        // healthy under a paused film has not been tested by anything.
        if (video.paused || video.ended) return;
        if (current < 0 || current >= wanted) return;
        if (bufferedAhead(video) < HEALTHY_BUFFER) return;

        const next = levels[current + 1];
        if (next && hls.bandwidthEstimate < next.bitrate * CLIMB_MARGIN) return;

        hls.currentLevel = current + 1;
      }

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        levels = (data.levels ?? []).map(readLevel);

        // Pin the highest rendition, and keep it pinned.
        //
        // `currentLevel` rather than `nextLevel`: this runs before the first
        // fragment has been chosen, so there is no buffer to throw away, and
        // `currentLevel` is also what takes the level out of ABR's hands — with
        // it set, hls.js stops re-deciding on every bandwidth sample, which is
        // the whole of "always the best quality" as opposed to "the best quality
        // when the connection happens to be good". `data.levels` is sorted by
        // bitrate ascending, so the last one is the top.
        //
        // The menu still switches: `setLevel` writes `currentLevel` too.
        //
        // What the pin cannot do is play a rung the connection cannot carry, and
        // left alone it does not fail visibly either — hls.js answers a stall
        // with nothing at all, so the film simply freezes on the top rung
        // forever. Hence the guard: the pin is ours, so we may walk it down when
        // it is proven undeliverable and back up when it is proven fine.
        if (levels.length > 1) {
          wanted = levels.length - 1;
          hls.currentLevel = wanted;

          clearInterval(guard);
          guard = setInterval(retune, RECHECK_MS);
        }

        current = hls.currentLevel;
        report('hls');
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        current = data.level;
        report('hls');
      });

      // Renditions belong to a level's audio group, so the list is not fixed for
      // the life of the stream: both of these fire when it changes, and between
      // them they cover a rung that carries a different set and a switch the
      // viewer asked for.
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, reportAudio);
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, reportAudio);

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed) return;

        /**
         * The picture has stopped because there is nothing left to play.
         *
         * This is the one error hls.js does not act on: its error controller
         * answers `BUFFER_STALLED_ERROR` with `createDoNothingErrorAction()`,
         * there is no retry, and the event is not even fatal — so it never
         * reaches the recovery below and the viewer is left with a frozen
         * frame and a spinner until the buffer happens to refill. With the rung
         * pinned there is nothing to refill it *from*, which is how a stream
         * that is merely too rich for the connection becomes a stream that
         * does not play.
         *
         * Reported once per stall, so this is one step down per episode of
         * stalling rather than one per frame of it.
         */
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          stepDown();
          return;
        }

        if (!data.fatal) return;

        /**
         * A refusal, not a hiccup.
         *
         * hls.js reports a `400` from the manifest or a segment as an ordinary
         * fatal network error, and the recovery below re-requests the same URL
         * with the same query — which is exactly what the server just said no
         * to. So a rejected stream was retried three times, taking several
         * seconds to fail, with the viewer watching a poster the whole while.
         * Anything in the 4xx range is an answer, and it will not change.
         */
        const status = data.response?.code ?? 0;
        if (status >= 400 && status < 500) {
          onError?.(new Error(`${data.details || 'Playback failed'} (HTTP ${status})`));
          dispose();
          return;
        }

        // A fatal error is one this instance will not get past on its own, but
        // the two common ones have a documented cure. Being dropped mid-stream
        // and a decoder that has wedged are both normal, and recovering is
        // better than reloading the whole source and losing the viewer's place.
        if (recoveries < MAX_RECOVERIES) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            recoveries += 1;
            hls.startLoad();
            return;
          }

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            recoveries += 1;
            hls.recoverMediaError();
            return;
          }
        }

        onError?.(new Error(data.details || `Playback failed (${data.type}).`));
        dispose();
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      onEngine?.({ engine: 'hls', levels: [], current: -1, auto: true });
    })
    .catch((error) => {
      if (!disposed) onError?.(error);
    });

  return { dispose, setLevel, setAudioTrack };
}
