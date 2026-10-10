'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { audioGraph, readLevel, resume } from '@/lib/player/audio-graph';
import {
  BIN_SECONDS,
  MAX_LAG_SECONDS,
  activitySignal,
  alignOffset,
} from '@/lib/player/sync';

/**
 * ============================================================================
 *  PLAYER — the "Sync to audio" session
 * ============================================================================
 *  Everything that turns the pure solver in `sync.js` into something a viewer
 *  can press and watch: the listening, the accumulating, the deciding when to
 *  believe the answer.
 *
 *  It is a hook rather than a few lines in the panel because a session outlives
 *  the panel. The viewer starts it, closes the panel and keeps watching; the
 *  answer converges with the panel shut and the subtitles correct themselves.
 *  The state machine therefore belongs above the menu, in `VideoPlayer`, and the
 *  panel is only a view of it.
 *
 *  ## The shape of a session
 *
 *  `idle → listening → done | unclear`
 *
 *    - **listening** — an animation frame loop reading the film's loudness into
 *      a 50 ms bin per tick, keyed by the media clock. The last two minutes of
 *      those bins are correlated against the subtitle track about once a second.
 *    - **done** — the estimate was confident and stayed put for a few seconds,
 *      so it was applied, and listening stopped by itself. This is the normal
 *      ending; the viewer does not have to press anything.
 *    - **unclear** — it never found anything worth believing. Music, effects
 *      and silence carry no alignment information, and saying so is the whole
 *      point of the confidence score. The panel reports it instead of applying
 *      a guess.
 *
 *  ## Why the bins are keyed by the media clock
 *
 *  Because that is the only key the correlation can use. The lag it solves for is
 *  a difference between the media's timeline and the file's, so a bin has to be
 *  addressable by *when in the film* it happened. Keying by "seconds since the
 *  viewer pressed start" would make a seek bend the timeline and the lag axis
 *  with it.
 *
 *  It also makes a seek mostly free: bins already collected stay exactly as
 *  valid as they were, because a seek does not change what the film sounded like
 *  at second 812. A backward seek re-visits bins that are already there and
 *  averages into them; a forward one leaves a hole. The hole is the reason the
 *  mask exists — those bins were never listened to, and a zero in the array would
 *  otherwise be counted as a moment of silence, which is the opposite of what not
 *  having listened means.
 *
 *  Bins are held in a fixed ring covering ten minutes, which is far more than the
 *  two-minute window that is ever correlated: past that, the oldest are dropped
 *  and the origin slides. Ten minutes of film at 50 ms is 48 KB, and it means a
 *  viewer syncing at minute 90 of a three-hour film gets the same thing as one
 *  syncing at minute one.
 * ============================================================================
 */

/** How much of the film is correlated at once. Longer is steadier and staler. */
const WINDOW_SECONDS = 120;

/** How long a listening session may run before it gives up and reports. */
const MAX_SECONDS = 120;

/**
 * How long the viewer must watch before an answer is worth offering at all.
 *
 * Above `sync.js`'s own floor, which is a floor on arithmetic rather than on
 * usefulness: a correlation over fifteen seconds of a film is a real number that
 * means very little, and the panel would be showing it to somebody who is still
 * deciding whether the feature works.
 */
const MIN_SECONDS = 20;

/** How often the estimate is recomputed, in seconds listened. */
const RECOMPUTE_EVERY = 1;

/**
 * The correlation below which the answer is noise rather than a match.
 *
 * The probe puts unrelated audio at r ≈ 0.13 and real audio at r ≈ 0.8, so the
 * gap this has to sit in is wide. It is well below the honest cases because the
 * cost of the two mistakes is not symmetric: refusing a real match leaves the
 * viewer where they already were, and applying a false one moves every subtitle
 * in the film by a number nobody chose.
 */
const MIN_SCORE = 0.35;

/** How far the estimate may wander and still count as having settled. */
const STEADY_WINDOW = 0.2;

/** How long it must stay inside that before it is applied, in seconds listened. */
const STEADY_SECONDS = 5;

/** The ring, in bins. `WINDOW_SECONDS` of correlated history plus room to slide. */
const CAPACITY = Math.round(600 / BIN_SECONDS);

/** The window, in bins. */
const WINDOW_BINS = Math.round(WINDOW_SECONDS / BIN_SECONDS);

/** The padding either side of the window that makes wide lags scored fairly. */
const LEAD = Math.round(MAX_LAG_SECONDS / BIN_SECONDS);

/** To the tenth of a second the stepper itself works in. */
function round(value) {
  return Math.round(value * 10) / 10;
}

/**
 * @param {object} props
 * @param {HTMLVideoElement|null} props.video
 * @param {object[]} props.cues       the track currently on, parsed and sorted
 * @param {(offset: number) => void} props.onApply  given the delay to apply
 * @returns {{status: string, seconds: number, offset: number|null,
 *            score: number, start: () => void, stop: () => void,
 *            cancel: () => void}}
 *          `status` is `idle` | `listening` | `done` | `unclear` | `unsupported`.
 *          `offset` is the live estimate while listening and the applied one
 *          afterwards; positive means the subtitles should appear later.
 */
export default function useAudioSync({ video, cues, onApply }) {
  const [state, setState] = useState({ status: 'idle', seconds: 0, offset: null, score: 0 });

  /** The current session, or null when nothing is listening. */
  const session = useRef(null);

  // The loop reads these, and it outlives any given render — the panel can be
  // closed and `onApply` can change identity while it runs. A ref keeps it
  // reading today's values rather than the ones it closed over when it started.
  const latest = useRef({ video, cues, onApply });
  useEffect(() => {
    latest.current = { video, cues, onApply };
  });

  /** Stops the loop and drops the accumulation. Returns the finished session. */
  const finish = useCallback(() => {
    const running = session.current;
    if (!running) return null;

    cancelAnimationFrame(running.frame);
    session.current = null;

    return running;
  }, []);

  /** Ends the session, having applied `answer`. */
  const apply = useCallback((running, answer) => {
    finish();
    latest.current.onApply?.(answer.offset);
    setState({
      status: 'done',
      seconds: running.elapsed,
      offset: answer.offset,
      score: answer.score,
    });
  }, [finish]);

  /**
   * Reads the audio and re-estimates, about once a second.
   *
   * Recomputing on a timer rather than every frame is not only about cost —
   * though it is mostly about cost, since it is a few hundred correlations on
   * the main thread and the viewer is watching a film. It is also that the
   * answer barely moves between one second and the next, and a number that
   * jitters on screen reads as a number that is not sure of itself.
   */
  const recompute = useCallback((running) => {
    const { cues: track } = latest.current;

    // Nothing to line up against — the track was turned off under a running
    // session, or the file parsed to nothing. Continuing to listen would be
    // listening with nothing to compare against, so the session ends and says
    // so rather than running out its own clock first.
    if (!track?.length) {
      finish();
      setState({ status: 'unclear', seconds: running.elapsed, offset: null, score: 0 });
      return;
    }

    if (running.elapsed < MIN_SECONDS) return;

    // The tail of what was listened to, which is all that is ever correlated.
    const end = running.filled;
    const start = Math.max(0, end - WINDOW_BINS);
    const count = end - start;
    if (!count) return;

    const audio = running.bins.subarray(start, end);
    const mask = running.mask.subarray(start, end);

    // The file times that line up with those bins, padded both ways so that a
    // lag at the edge of the range is still scored over the whole window.
    const from = running.origin + start * BIN_SECONDS - MAX_LAG_SECONDS;
    const activity = activitySignal(track, from, count + 2 * LEAD, BIN_SECONDS);

    const found = alignOffset(audio, activity, {
      binSeconds: BIN_SECONDS,
      maxLagSeconds: MAX_LAG_SECONDS,
      lead: LEAD,
      mask,
    });

    running.latest = found && found.score >= MIN_SCORE
      ? { offset: round(found.offset), score: found.score }
      : null;

    // Settling, not just scoring. A correlation over a growing window can be
    // confident on one second and confident about something else on the next,
    // and applying the first confident thing it says would move the subtitles
    // under the viewer mid-scene. It has to say the same thing for a while.
    if (!running.latest) {
      running.settled = null;
    } else if (
      running.settled
      && Math.abs(running.latest.offset - running.settled.offset) <= STEADY_WINDOW
    ) {
      // The clock on "has it stopped moving" starts at the second sighting, so
      // that two readings a second apart are not enough on their own.
      running.settled.since ??= running.elapsed;
    } else {
      running.settled = { offset: running.latest.offset, since: null };
    }

    const since = running.settled?.since;
    const held = typeof since === 'number' && running.elapsed - since >= STEADY_SECONDS;

    if (held) {
      apply(running, running.latest);
      return;
    }

    // Long enough to be worth listening for, and it still has not settled. If
    // there is anything in hand it is handed over rather than thrown away — the
    // viewer has spent two minutes of their film on this — and if there is not,
    // that is the answer.
    if (running.elapsed >= MAX_SECONDS) {
      if (running.latest) apply(running, running.latest);
      else {
        finish();
        setState({ status: 'unclear', seconds: running.elapsed, offset: null, score: 0 });
      }
      return;
    }

    // While the score dips, the number on screen holds its last good value
    // rather than dropping to zero and climbing again: the reading is a settled
    // thing and the correlation under it is not.
    if (running.latest) running.lastShown = running.latest;

    setState({
      status: 'listening',
      seconds: running.elapsed,
      offset: running.lastShown?.offset ?? null,
      score: running.latest?.score ?? 0,
    });
  }, [apply, finish]);

  /** One frame: sample the film, and every so often re-estimate. */
  const tick = useCallback((running) => {
    running.frame = requestAnimationFrame(() => tick(running));

    const { video: element } = latest.current;
    // A paused film repeats the same sample forever, which would fill one bin
    // with a thousand readings and no others. The loop stays up so that it
    // picks straight back up on play without waiting for an event.
    if (!element || element.paused || element.ended) return;

    const read = readLevel(running.graph);
    if (!read) return;

    // The graph is fed from the decoder and heard later, so the sample in hand
    // belongs to a moment already past. Keying it by `currentTime` would bias
    // every answer by the depth of the output buffer — small, but the one kind
    // of error a correlation cannot see.
    const at = element.currentTime - read.latency;

    // How much film has gone by, counted off the film's own clock rather than
    // off how much new ground was covered. A viewer who seeks backwards is
    // re-listening to bins that are already filled, and a session whose
    // progress only advanced on new ground would sit frozen for the rest of the
    // run — never reaching its own time limit, never re-estimating.
    //
    // Capped per tick, so a seek is not counted as an hour of listening.
    const delta = at - running.lastAt;
    running.lastAt = at;
    if (delta > 0) running.elapsed += Math.min(delta, RECOMPUTE_EVERY);

    let index = Math.floor((at - running.origin) / BIN_SECONDS);

    if (index >= CAPACITY) {
      const drop = CAPACITY - WINDOW_BINS;

      if (index - drop >= CAPACITY) {
        // Too far to slide to. History from the other side of a jump like that
        // is not the same stretch of film as where the viewer now is, so it is
        // dropped rather than carried across, and the session starts again from
        // here — which the counting above then reports honestly as a restart.
        running.bins.fill(0);
        running.mask.fill(0);
        running.counts.fill(0);
        running.origin = at;
        running.filled = 0;
        running.elapsed = 0;
        running.lastCheck = 0;
        running.latest = null;
        running.lastShown = null;
        running.settled = null;
        index = 0;
      } else {
        // The ring is full: drop the oldest half and slide the origin up to it.
        // The bins that survive are the ones the next window will be taken from,
        // so nothing already listened to is thrown away while it is still usable.
        running.bins.copyWithin(0, drop, CAPACITY);
        running.mask.copyWithin(0, drop, CAPACITY);
        running.counts.copyWithin(0, drop, CAPACITY);
        running.bins.fill(0, WINDOW_BINS);
        running.mask.fill(0, WINDOW_BINS);
        running.counts.fill(0, WINDOW_BINS);
        running.origin += drop * BIN_SECONDS;
        running.filled -= drop;
        index -= drop;
      }
    }

    if (index < 0 || index >= CAPACITY) return;

    // The mean of whatever landed in the bin, so a slow frame does not make the
    // moment look quieter than a fast one did.
    const seen = running.counts[index];
    running.bins[index] = (running.bins[index] * seen + read.level) / (seen + 1);
    running.counts[index] = seen + 1;
    running.mask[index] = 1;

    if (index + 1 > running.filled) running.filled = index + 1;

    if (running.elapsed - running.lastCheck < RECOMPUTE_EVERY) return;
    running.lastCheck = running.elapsed;

    // A context can be suspended under us — a backgrounded tab, an audio
    // interruption — and a suspended context measures nothing at all.
    resume(running.graph);
    recompute(running);
  }, [recompute]);

  /** Opens a session and starts listening. */
  const start = useCallback(() => {
    const { video: element } = latest.current;
    if (!element) return;

    finish();

    // Built here rather than at mount, because an `AudioContext` made without a
    // user gesture starts suspended, and this is called from the press. See
    // `audio-graph.js`, which explains why the graph is built once and kept.
    const graph = audioGraph(element);
    if (!graph) {
      setState({ status: 'unsupported', seconds: 0, offset: null, score: 0 });
      return;
    }

    // Wakes it if this is a second run and the context has since slept.
    resume(graph);

    session.current = {
      graph,
      frame: 0,
      origin: element.currentTime,
      bins: new Float32Array(CAPACITY),
      mask: new Uint8Array(CAPACITY),
      counts: new Uint16Array(CAPACITY),
      filled: 0,
      elapsed: 0,
      lastAt: element.currentTime,
      lastCheck: 0,
      latest: null,
      lastShown: null,
      settled: null,
    };

    setState({ status: 'listening', seconds: 0, offset: null, score: 0 });
    tick(session.current);
  }, [finish, tick]);

  /**
   * Ends the session, applying the best estimate if there is one worth applying.
   *
   * Stopping is not cancelling: a viewer who presses Stop has listened for as
   * long as they intend to and wants what was found. It is only refused when
   * what was found was too weak to be worth moving the subtitles for — in which
   * case saying so is more use than applying it.
   */
  const stop = useCallback(() => {
    const running = finish();
    if (!running) return;

    if (running.latest && running.elapsed >= MIN_SECONDS) {
      apply(running, running.latest);
      return;
    }

    setState({
      status: 'unclear',
      seconds: running.elapsed,
      offset: null,
      score: running.latest?.score ?? 0,
    });
  }, [apply, finish]);

  /**
   * Ends the session and throws the estimate away.
   *
   * Deliberately not what closing the panel does — a run outlives the panel on
   * purpose, so that starting it does not mean sitting and watching a number
   * instead of the film. This is the viewer saying no to a run that is going
   * badly, and it is the only way to get back to `idle` without applying
   * something.
   */
  const cancel = useCallback(() => {
    if (!finish()) return;
    setState({ status: 'idle', seconds: 0, offset: null, score: 0 });
  }, [finish]);

  // A session that is still listening when the player goes away would keep an
  // animation frame loop alive against a detached element. The graph itself is
  // deliberately not torn down — it belongs to the element, and it cannot be.
  useEffect(() => finish, [finish]);

  return { ...state, start, stop, cancel };
}
