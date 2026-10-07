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

/** Whether a source is an HLS playlist, from its declared type or its URL. */
function isHls(src, type) {
  if (type) return /mpegurl/i.test(type);
  return /\.m3u8(\?|#|$)/i.test(String(src ?? ''));
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
 * @param {(error: Error) => void} [handlers.onError]
 * @returns {{ dispose: () => void, setLevel: (index: number|null) => void }}
 */
export function attachSource(video, src, { type, headers, onEngine, onError } = {}) {
  let disposed = false;
  let hls = null;
  let recoveries = 0;
  let levels = [];
  let current = -1;

  const report = (engine) => {
    if (disposed) return;
    onEngine?.({ engine, levels, current, auto: current === -1 });
  };

  /** Undoes everything this call did. Safe to call twice, and from anywhere. */
  function dispose() {
    disposed = true;

    if (hls) {
      // `destroy()`, not `detachMedia()`. Detaching leaves the loader running —
      // still fetching segments for a video element nobody is watching.
      hls.destroy();
      hls = null;
    }

    // An hls.js instance sets `src` to a blob URL it owns; clearing it stops a
    // direct source from continuing to download in the background after a
    // source change.
    video.removeAttribute('src');
    video.load();
  }

  /** A manual level, or `-1` for automatic. A no-op on engines without levels. */
  function setLevel(index) {
    if (!hls || disposed) return;
    hls.currentLevel = index === null ? -1 : index;
  }

  if (!src) return { dispose, setLevel };

  if (!isHls(src, type)) {
    // An mp4, or anything else the browser can play on its own.
    video.src = src;
    onEngine?.({ engine: 'direct', levels: [], current: -1, auto: true });
    return { dispose, setLevel };
  }

  // --- native HLS ---------------------------------------------------------
  // Safari reports 'maybe' or 'probably'; everything else reports ''. The check
  // is deliberately before the hls.js branch, because on iOS hls.js is not an
  // option and on Safari the native path is the better one.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    onEngine?.({ engine: 'native', levels: [], current: -1, auto: true });
    return { dispose, setLevel };
  }

  if (!MSE) {
    onError?.(new Error('This browser cannot play HLS.'));
    return { dispose, setLevel };
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
        // Start at the top of the ladder and let bandwidth take it down, which
        // is the behaviour a viewer expects from every other player.
        startLevel: -1,
        // Keep a small buffer: the default is tuned for a shared CDN budget
        // rather than for starting quickly.
        maxBufferLength: 30,
        enableWorker: true,
        ...headerConfig(headers),
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        levels = (data.levels ?? []).map(readLevel);
        current = hls.currentLevel;
        report('hls');
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        current = data.level;
        report('hls');
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed || !data.fatal) return;

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

  return { dispose, setLevel };
}
