/**
 * ============================================================================
 *  PROVIDERS — measuring a stream
 * ============================================================================
 *  "Which source is best" is a question nobody can answer by reading the resolve
 *  response. A provider hands back URLs, and a URL says nothing about the picture
 *  behind it: the same film came back from one provider as a ladder topping out
 *  at 3840x2160 and from another at 1920x800. The only honest way to compare them
 *  is to ask each one what it actually has, which means reading its manifest.
 *
 *  That is all this does. An HLS master playlist declares the rungs of its ladder
 *  in `#EXT-X-STREAM-INF` lines, each carrying the `RESOLUTION` that variant will
 *  be decoded at, so one small GET — a few kilobytes, no segments, nothing
 *  decoded — is enough to know the ceiling of a stream. Both of the streams this
 *  site plays are reachable that way: the proxied ones are same-origin by
 *  construction, and the direct ones come from a host that reflects our origin
 *  back in `Access-Control-Allow-Origin`.
 *
 *  Two things it deliberately does not do. It does not measure throughput: a
 *  2160p stream on a host that cannot keep up is a miserable experience and this
 *  cannot see that, so it does not pretend to — resolution is the honest proxy
 *  available before anything is downloaded, and the viewer who disagrees has the
 *  source menu. And it does not guess: a stream that is not HLS, or whose
 *  manifest is unreachable, measures as `null` rather than as some default, so
 *  that "we could not tell" stays distinguishable from "it is small".
 * ============================================================================
 */

/**
 * The resolution a variant plays at, as HLS declares it.
 *
 * `#EXT-X-STREAM-INF:BANDWIDTH=682018,CODECS="...",RESOLUTION=1920x800,...`
 */
const RESOLUTION = /RESOLUTION=(\d+)x(\d+)/g;

/**
 * How long a probe waits before giving up and calling the stream unmeasured.
 *
 * This is a manifest, so if it has not arrived in a few seconds it is not slow,
 * it is not coming. Failing fast matters more than being patient here: a probe
 * holds up the choice of what to play, and a choice made on one provider's
 * measurement is better than a spinner waiting on the other's.
 */
const PROBE_TIMEOUT_MS = 4_000;

/**
 * The widest variant in a manifest, or null if it declares none.
 *
 * **Width, not height, and that is the whole subtlety.** Height varies with the
 * film's aspect ratio: a 1080p copy of a 2.39:1 film is 1920x800 and a 720p copy
 * of a 16:9 one is 1280x720, so ranking on height would call the 720p stream —
 * 921,600 pixels against 1,536,000 — the better of the two. Width is the
 * horizontal resolution class and does not move with the letterbox: 1280, 1920
 * and 3840 mean 720p, 1080p and 2160p for any shape of picture.
 */
function readResolution(text) {
  let best = null;

  for (const [, width, height] of text.matchAll(RESOLUTION)) {
    const value = Number(width);
    if (!best || value > best.width) best = { width: value, height: Number(height) };
  }

  return best;
}

/**
 * What a stream tops out at, or null when that cannot be determined.
 *
 * @param {string} src  the stream URL — a master playlist, for anything HLS
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]  the caller's, so a viewer leaving the
 *        page takes the probe with them instead of leaving it to time out
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{width: number, height: number, label: string}|null>}
 *          `label` is how the rung would be named in the quality menu, so the
 *          number a viewer sees when choosing a source is the same one they see
 *          after choosing it.
 */
export async function measureStream(src, { signal, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (typeof src !== 'string' || src.length === 0) return null;

  const controller = new AbortController();
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay, { once: true });
  const deadline = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(src, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;

    const resolution = readResolution(await response.text());
    return resolution ? { ...resolution, label: `${resolution.height}p` } : null;
  } catch {
    // Unreachable, forbidden, not HLS, timed out — all of them mean this stream
    // has no measured quality, and none of them are worth telling the viewer
    // about, because the stream itself is about to be shown to them regardless.
    return null;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', relay);
  }
}
