/**
 * ============================================================================
 *  HOW BIG IS THIS STREAM?
 * ============================================================================
 *
 *  "Which source is best" cannot be answered from a resolve response. A provider
 *  hands back URLs and a URL says nothing about the picture behind it — one
 *  provider on one title will offer a 480p file and a 1080p file under the same
 *  name, and only one of them is worth watching.
 *
 *  There are two places a stream can admit its size, and this asks both:
 *
 *  1. **The playlist**, if it is a master. `#EXT-X-STREAM-INF` lists the rungs
 *     of a ladder and each one carries the `RESOLUTION` it decodes at. One small
 *     GET and the answer is explicit.
 *
 *  2. **The video**, if it is not. A media playlist describes one rendition and
 *     says nothing about it, but the H.264 stream it points at opens with a
 *     sequence parameter set that states the coded width and height outright.
 *     So the first segment is fetched — the first 128 KB of it, not the whole
 *     thing — and `transport-stream.js` reads the size out of it.
 *
 *  Both routes end in a number that somebody wrote down, so neither is a guess.
 *  A stream that answers neither reads as `null` rather than as a default, which
 *  keeps "we could not tell" distinguishable from "it is small".
 *
 *  Server-side. This runs in the resolve route, which is the only place that has
 *  the referer these hosts want and is the only place that can reach them.
 * ============================================================================
 */

import { fetchWithDeadline } from '@/lib/proxy/stream';
import { transportStreamResolution } from './transport-stream';

/**
 * How long a probe gets.
 *
 * Two requests — a playlist and a slice of one segment — and both are small. If
 * they have not arrived in this long they are not slow, they are not coming.
 * Failing fast matters more than being patient: a probe decides what plays, and
 * a title that plays a measured stream beats one that waits on an unmeasured one.
 */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * How much of a segment to ask for.
 *
 * The parameter set is at the very front of the video — within the first few
 * kilobytes — so this is two orders of magnitude more than it needs. It is set
 * by the other end instead: a segment is a couple of megabytes, and asking for a
 * slice this size is the difference between a probe that is invisible and one
 * that puts a video download on the wire every time somebody opens a title.
 */
const HEAD_BYTES = 128 * 1024;

/**
 * A host that would not serve the playlist: nothing here, nothing to keep.
 *
 * A fresh object each time rather than a shared constant, because callers hang
 * the measurement off it and a shared one would collect whatever the last
 * stream was.
 */
function dead() {
  return { reachable: false, quality: null };
}

/** The host answered; `quality` is what it told us, or null if it told us nothing. */
function alive(quality) {
  return { reachable: true, quality };
}

const DEAD = dead();

/** `#EXT-X-STREAM-INF:BANDWIDTH=...RESOLUTION=1920x800,...` */
const RESOLUTION = /RESOLUTION=(\d+)x(\d+)/g;

/**
 * The widest rung a master playlist declares, or null if it declares none.
 *
 * **Width, not height, and that is the whole subtlety.** Height varies with the
 * film's aspect ratio: a 1080p copy of a 2.39:1 film is 1920x800 and a 720p copy
 * of a 16:9 one is 1280x720, so ranking on height would call the 720p stream —
 * 921,600 pixels against 1,536,000 — the better of the two. Width is the
 * horizontal resolution class and does not move with the letterbox: 1280, 1920
 * and 3840 mean 720p, 1080p and 2160p for any shape of picture.
 */
export function declaredResolution(playlistText) {
  let best = null;

  for (const [, width, height] of String(playlistText).matchAll(RESOLUTION)) {
    const value = Number(width);
    if (!best || value > best.width) best = { width: value, height: Number(height) };
  }

  return best;
}

/** The first segment a playlist names, resolved against the playlist's own URL. */
function firstSegment(playlistText, playlistUrl) {
  for (const line of String(playlistText).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      return new URL(trimmed, playlistUrl).href;
    } catch {
      return null;
    }
  }

  return null;
}

/** At most `limit` bytes of a body, whether or not the host honoured `Range`. */
async function readAtMost(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer()).subarray(0, limit);

  const chunks = [];
  let length = 0;

  while (length < limit) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    chunks.push(value);
    length += value.length;
  }

  // Long before the end, every time the host ignores `Range` — which is the
  // case this exists for. Cancelling rather than reading on means a probe costs
  // a packet or two of a segment instead of all of it.
  if (length >= limit) await reader.cancel().catch(() => {});

  const bytes = new Uint8Array(Math.min(length, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const room = bytes.length - offset;
    if (room <= 0) break;
    bytes.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.length, room);
  }

  return bytes;
}

/**
 * What a stream tops out at, or null when that cannot be determined.
 *
 * @param {string} url  the stream's playlist
 * @param {object} [options]
 * @param {Record<string, string>} [options.headers]  what the host wants to see
 * @param {AbortSignal} [options.signal]  the caller's, so a viewer leaving the
 *        page takes the probe with them instead of leaving it to time out
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{reachable: boolean, quality: {width: number, height: number,
 *          label: string}|null}>}
 *          `reachable` is false when the host would not even serve the playlist,
 *          which is the only reading that says a stream is no good. A stream that
 *          answers but declares nothing is reachable with a null quality, and
 *          the two must not be collapsed: one is a stream to drop, the other is
 *          a stream to keep and simply not rank.
 *
 *          `label` is how the rung is named in the quality menu, so the number a
 *          viewer sees when choosing a source is the one they see after choosing
 *          it.
 */
export async function probeStream(url, { headers, signal, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (typeof url !== 'string' || url.length === 0) return DEAD;

  let playlist;
  try {
    playlist = await fetchWithDeadline(
      url,
      { headers, redirect: 'follow', cache: 'no-store', signal },
      timeoutMs,
    );
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return DEAD;
  }

  // A host that refuses the playlist is a host that had nothing to offer, which
  // is an answer worth having: the caller uses it to drop the stream.
  if (!playlist.ok) return DEAD;

  const text = await playlist.text();

  const declared = declaredResolution(text);
  if (declared) return alive({ ...declared, label: `${declared.height}p` });

  const segment = firstSegment(text, url);
  if (!segment) return alive(null);

  let head;
  try {
    head = await fetchWithDeadline(
      segment,
      {
        headers: { ...headers, Range: `bytes=0-${HEAD_BYTES - 1}` },
        redirect: 'follow',
        cache: 'no-store',
        signal,
      },
      timeoutMs,
    );
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return alive(null);
  }

  if (!head.ok) return alive(null);

  const resolution = transportStreamResolution(await readAtMost(head, HEAD_BYTES));
  return alive(resolution ? { ...resolution, label: `${resolution.height}p` } : null);
}
