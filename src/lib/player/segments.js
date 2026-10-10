/**
 * ============================================================================
 *  SKIPPABLE RANGES
 * ============================================================================
 *  The intro, recap and outro a title may have been timed for, and the two
 *  questions anything asks about them: which one the playhead is inside, and
 *  where each one sits on the seek bar.
 *
 *  It is a module of its own because two components need the same answers and
 *  neither can be trusted to keep its own copy honest — `VideoPlayer` decides
 *  whether to offer a skip, `PlayerControls` draws the bands. A second spelling
 *  of the order they occur in would be a second thing to keep in step.
 *
 *  Nothing here knows what a second is measured from. The ranges arrive already
 *  normalised, as seconds from the start of the title, from `src/lib/introdb.js`
 *  — which is also why this file has no fetch in it and can be reached from a
 *  Client Component.
 * ============================================================================
 */

/**
 * The three ranges, in the order they occur in an episode.
 *
 * Also the order of preference when two overlap, which is why it is earliest
 * first: taking the last match is taking the one that started most recently,
 * and so the one the viewer has just walked into rather than the one they are
 * already through.
 */
export const SEGMENT_ORDER = ['recap', 'intro', 'outro'];

/** Keeps a fraction inside the bar, whatever arithmetic produced it. */
const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

/**
 * Which range the playhead is inside, or `null`.
 *
 * The end is exclusive: at the instant the range ends the viewer is out of it,
 * and a button offering to skip to where they already are is a button that
 * looks broken.
 *
 * @param {{[type: string]: {start: number, end: number}|null}} segments
 * @param {number} time  seconds
 * @returns {'recap'|'intro'|'outro'|null}
 */
export function segmentAt(segments, time) {
  if (!segments || !Number.isFinite(time)) return null;

  let found = null;
  for (const type of SEGMENT_ORDER) {
    const range = segments[type];
    if (!range) continue;
    if (time < range.start || time >= range.end) continue;
    if (found === null || range.start > segments[found].start) found = type;
  }

  return found;
}

/**
 * The ranges as positions on a bar that represents `total` seconds.
 *
 * Percentages rather than seconds, because that is what the bar is laid out in
 * and doing the division in one place is what keeps the bands on the same scale
 * as the played fill. A range that rounds to nothing, or that falls entirely
 * outside the duration, is dropped rather than drawn as a sliver.
 *
 * @param {{[type: string]: {start: number, end: number}|null}} segments
 * @param {number} total  the title's duration, in seconds
 * @returns {{type: string, left: string, width: string}[]}
 */
export function segmentMarks(segments, total) {
  if (!segments || !Number.isFinite(total) || total <= 0) return [];

  const marks = [];
  for (const type of SEGMENT_ORDER) {
    const range = segments[type];
    if (!range) continue;

    const left = clamp01(range.start / total);
    const right = clamp01(range.end / total);
    if (right <= left) continue;

    marks.push({ type, left: `${left * 100}%`, width: `${(right - left) * 100}%` });
  }

  return marks;
}
