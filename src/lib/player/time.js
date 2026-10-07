/**
 * ============================================================================
 *  PLAYER — small numeric helpers
 * ============================================================================
 *  A player does two arithmetic things constantly: turn a number of seconds into
 *  something a human reads, and keep a number inside bounds. Both are here so no
 *  component invents its own.
 * ============================================================================
 */

/** Keeps `value` between `min` and `max`. `NaN` lands on `min`. */
export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Seconds as a clock: `0:07`, `4:12`, `1:02:03`.
 *
 * Hours only appear once there are any, because a trailer reading `0:00:07`
 * looks like a bug. A duration the browser has not worked out yet — `NaN`,
 * `Infinity`, or the `0` some streams report briefly — reads as `0:00` rather
 * than `NaN:NaN`, which is what a viewer sees on the frame before metadata
 * arrives.
 */
export function formatClock(seconds) {
  const total = Math.floor(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (value) => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
