/**
 * ============================================================================
 *  PLAYER — lining subtitles up with the audio
 * ============================================================================
 *  A subtitle file timed for a different release is out by a constant, and this
 *  is how that constant is found rather than guessed at a tenth of a second at a
 *  time.
 *
 *  The observation it rests on: a cue is on screen because somebody is talking,
 *  and talking is what the audio's loudness is doing at that moment. So the
 *  envelope of the audio and the on/off pattern of the subtitle track are two
 *  views of the same script, and the shift that brings them into step is the
 *  delay the viewer wants. Everything here is the least arithmetic that answers
 *  that question; the listening itself is `useAudioSync`, which is not pure and
 *  is not here.
 *
 *  Two properties of the answer are worth knowing before reading the code:
 *
 *    - It is a **heuristic**. Music, effects and silence carry no alignment
 *      information, and a window full of them produces a number that means
 *      nothing. That is why `alignOffset` reports how strong the match was
 *      alongside where it was, and why its caller is expected to refuse a weak
 *      one rather than show it.
 *    - It is **pure** — no DOM, no Web Audio, no React, and no imports at all.
 *      That is what lets `scripts/sync-probe.mjs` check it from a terminal
 *      against signals whose offset is known, which is the only way to know the
 *      solver works without a film to hand.
 * ============================================================================
 */

/**
 * The sign convention, in one place, because it is the easiest thing here to get
 * backwards and much the hardest to notice afterwards:
 *
 *   A cue at file time `u` is shown at media time `u + delay` — the overlay asks
 *   `cueAt` for `time - delay`, for exactly that reason. So a positive delay means
 *   the subtitles appear **later**, which is what the Captions menu's "+" button
 *   promises.
 *
 * So if a cue belongs `D` seconds further into the media than the file claims,
 * the answer is `delay = D`, and the lag worth looking for is the one that pairs
 * the audio at media time `t` with subtitle activity at file time `t - D`.
 * `alignOffset` returns that `D` directly: no sign flip for a caller to get
 * wrong.
 */

/** How wide one measurement is, in seconds. Finer than this is below the noise. */
export const BIN_SECONDS = 0.05;

/** How far out of step a file is assumed to be. Wider than the stepper's ±30 s. */
export const MAX_LAG_SECONDS = 30;

/**
 * How little of the window a lag may use before it is not worth scoring.
 *
 * Only reachable at the very ends of a short listen, where an extent lag would
 * otherwise be scored on a handful of bins and would win by accident.
 */
const MIN_OVERLAP = 0.5;

/** Below this many bins there is nothing to correlate. Half a minute of audio. */
const MIN_BINS = 300;

/**
 * How far apart the first pass of the search looks, in bins.
 *
 * Eighth of a second. Wide enough to cut the work by an order of magnitude,
 * narrow enough that a speech envelope — which does not go from quiet to loud
 * and back inside that — cannot hide a peak between two samples of it.
 */
const COARSE_STEP = 8;

/**
 * The subtitle side of the comparison: one value per bin, 1 where a cue is on
 * screen and 0 where none is.
 *
 * Built from the file's **own** timings, not from anything shifted by the current
 * delay — the delay is what is being solved for, and folding the viewer's current
 * guess into the question would only make the answer agree with it.
 *
 * @param {{startMs: number, endMs: number}[]} cues  sorted by `startMs`
 * @param {number} from        file time the first bin covers, in seconds
 * @param {number} count       how many bins
 * @param {number} [binSeconds]
 * @returns {Float32Array}
 */
export function activitySignal(cues, from, count, binSeconds = BIN_SECONDS) {
  const signal = new Float32Array(Math.max(0, count));

  for (const cue of cues ?? []) {
    // Clamped to the window before the walk, so a three-hour track costs the
    // same as a one-minute one: only cues overlapping the window do any work,
    // and each does at most `count` of it.
    const first = Math.max(0, Math.floor((cue.startMs / 1000 - from) / binSeconds));
    const after = Math.min(signal.length, Math.ceil((cue.endMs / 1000 - from) / binSeconds));

    for (let index = first; index < after; index += 1) signal[index] = 1;
  }

  return signal;
}

/**
 * Pearson correlation between `audio[i]` and `activity[i - lag + lead]` over the
 * bins both of them have something to say about.
 *
 * `mask` is which audio bins were actually measured. A bin is left unmeasured by
 * a pause, a seek, or the moment before the first tick, and its zero would
 * otherwise read as silence — which is real information about the film, and the
 * opposite of what not having listened means.
 *
 * The count comes back with the score rather than being counted separately: how
 * much evidence a lag was decided on is exactly how much overlap it had.
 *
 * @returns {{score: number, count: number}|null}
 *          null when either side is constant over the overlap, which is a
 *          question with no answer rather than a correlation of zero.
 */
function correlate(audio, activity, mask, lead, lag) {
  let count = 0;
  let sumAudio = 0;
  let sumActivity = 0;

  for (let index = 0; index < audio.length; index += 1) {
    if (mask && !mask[index]) continue;

    const other = index - lag + lead;
    if (other < 0 || other >= activity.length) continue;

    count += 1;
    sumAudio += audio[index];
    sumActivity += activity[other];
  }

  if (count === 0) return null;

  const meanAudio = sumAudio / count;
  const meanActivity = sumActivity / count;

  let covariance = 0;
  let varianceAudio = 0;
  let varianceActivity = 0;

  for (let index = 0; index < audio.length; index += 1) {
    if (mask && !mask[index]) continue;

    const other = index - lag + lead;
    if (other < 0 || other >= activity.length) continue;

    const a = audio[index] - meanAudio;
    const b = activity[other] - meanActivity;

    covariance += a * b;
    varianceAudio += a * a;
    varianceActivity += b * b;
  }

  // Either the film said nothing over this stretch or the subtitles did. Both
  // are "there is no correlation to find", not "the correlation is zero".
  if (varianceAudio <= 0 || varianceActivity <= 0) return null;

  return { score: covariance / Math.sqrt(varianceAudio * varianceActivity), count };
}

/** The median of a list of numbers. Enough of a centre to measure a peak against. */
function median(values) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Scores every lag from `from` to `to` in `step`-bin strides.
 *
 * @returns {{scores: number[], best: {lag: number, score: number}|null}}
 */
function sweep(audio, activity, mask, lead, from, to, step) {
  const scores = [];
  let best = null;

  // Once, not per lag: it is a walk of every bin, and this runs a few hundred
  // times a second in the middle of the play-out.
  const floor = measuredOf(mask, audio) * MIN_OVERLAP;

  for (let lag = from; lag <= to; lag += step) {
    const found = correlate(audio, activity, mask, lead, lag);
    if (!found) continue;

    // A lag scored on a sliver of the window is a lag that won by accident, so
    // it is dropped rather than allowed to compete with the ones decided on the
    // whole of it. Only the padded ends are ever thin.
    if (found.count < floor) continue;

    scores.push(found.score);
    if (!best || found.score > best.score) best = { lag, score: found.score };
  }

  return { scores, best };
}

/** How many of the audio's bins were actually listened to. */
function measuredOf(mask, audio) {
  if (!mask) return audio.length;

  let filled = 0;
  for (let index = 0; index < audio.length; index += 1) filled += mask[index] ? 1 : 0;

  return filled;
}

/**
 * The shift that best lines the subtitles up with the audio.
 *
 * Every candidate lag in ±`maxLagSeconds` is scored by the correlation above,
 * and the best one wins. The lag is searched at one-bin resolution because that
 * is the resolution the audio was measured at; a finer answer would be finer than
 * the evidence.
 *
 * `lead` is the padding at the front of `activity`: `activity[lead]` and
 * `audio[0]` describe the same moment. The caller pads by `maxLagSeconds` at both
 * ends so that even the widest lag is scored over the whole window rather than
 * over whatever sliver is left after the shift — without it, the extreme lags are
 * decided by a tenth of the evidence and win by accident.
 *
 * @param {Float32Array} audio     one RMS per bin, indexed from the window's start
 * @param {Float32Array} activity  the same bins, padded by `lead` at the front
 * @param {object} [options]
 * @param {number} [options.binSeconds]
 * @param {number} [options.maxLagSeconds]
 * @param {number} [options.lead]  bins of padding in front of `activity`
 * @param {Uint8Array|null} [options.mask]  which audio bins were measured
 * @returns {{offset: number, score: number, contrast: number}|null}
 *          `offset` in seconds, positive meaning the subtitles should appear
 *          later; null when nothing could be concluded.
 */
export function alignOffset(audio, activity, {
  binSeconds = BIN_SECONDS,
  maxLagSeconds = MAX_LAG_SECONDS,
  lead = 0,
  mask = null,
} = {}) {
  if (measuredOf(mask, audio) < MIN_BINS) return null;

  const maxLag = Math.round(maxLagSeconds / binSeconds);

  // Searched in two passes rather than one, and not for elegance: this runs on
  // the main thread once a second while the film is playing, and the exhaustive
  // version is ~1200 lags × 2 passes over every bin — tens of milliseconds on a
  // desktop and several frames dropped on a phone, every second, for a listener
  // who is watching a film at the time. A coarse sweep over the whole range
  // finds the neighbourhood; the fine sweep spends the full resolution only
  // there. Both signals are smooth over a fraction of a second, so the coarse
  // pass cannot step over a peak it matters about.
  const coarse = sweep(audio, activity, mask, lead, -maxLag, maxLag, COARSE_STEP);
  if (!coarse.best) return null;

  const fine = sweep(
    audio,
    activity,
    mask,
    lead,
    coarse.best.lag - COARSE_STEP,
    coarse.best.lag + COARSE_STEP,
    1,
  );

  const best = fine.best ?? coarse.best;

  // How far clear of the pack the winner is. A true match is a peak; a window
  // with nothing to align on produces a field of similar noise where whichever
  // lag came top says nothing at all. Reporting the gap lets the caller tell
  // those two apart without knowing anything about correlation.
  const contrast = best.score - median([...coarse.scores, ...fine.scores]);

  return { offset: best.lag * binSeconds, score: best.score, contrast };
}
