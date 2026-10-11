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
 *  believe the answer — and, once it has one, the deciding when to believe a new
 *  one instead.
 *
 *  It is a hook rather than a few lines in the panel because a session outlives
 *  the panel. The viewer starts it, closes the panel and keeps watching; the
 *  answer converges with the panel shut and the subtitles correct themselves.
 *  The state machine therefore belongs above the menu, in `VideoPlayer`, and the
 *  panel is only a view of it.
 *
 *  ## The shape of a session
 *
 *  `idle → live → done | unclear`
 *
 *    - **live** — an animation frame loop reading the film's loudness into a
 *      50 ms bin per tick, keyed by the media clock. The last two minutes of
 *      those bins are correlated against the subtitle track, and the shift that
 *      lines them up is applied. Then it keeps going: the window slides with the
 *      film, the estimate is re-derived, and a fresh answer that disagrees with
 *      the one in effect is applied in its turn.
 *    - **done** — the viewer pressed Stop (or took the delay by hand). Listening
 *      ended; whatever offset was in effect stays in effect.
 *    - **unclear** — it was stopped before it ever found anything worth
 *      believing. Music, effects and silence carry no alignment information,
 *      and saying so is the whole point of the confidence score.
 *
 *  ## Why it runs continuously, and why that is not a cost paid for nothing
 *
 *  The solver asks an absolute question — where does the file sit against the
 *  film — and builds the subtitle side of the comparison from the file's **own**
 *  timings, never from the delay already in effect. So it is idempotent: run it
 *  again over a later stretch of the same film and it returns the same answer,
 *  and run it after a seek and it still returns the right one. That is what lets
 *  a session stay up for the whole film, and it is why there is no second
 *  algorithm here for "keep it in sync" — there is only the one, asked again.
 *
 *  What it buys is the two cases a single answer cannot survive. A file that
 *  **drifts** is out by a different amount in the last act than in the first, and
 *  a window that has slid to the last act measures the last act. And a first
 *  answer that was confidently wrong — a stretch that happened to correlate —
 *  is contradicted and replaced by the next window that disagrees.
 *
 *  The price is recomputing in the background for hours, which is why the cadence
 *  below is not the one-second one it uses to converge: once an offset is in
 *  effect it is re-derived every `RECHECK_SECONDS`, and immediately only after
 *  something that invalidates it — a seek, or the track changing.
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

/**
 * How long the viewer must watch before an answer is worth offering at all.
 *
 * Above `sync.js`'s own floor, which is a floor on arithmetic rather than on
 * usefulness: a correlation over fifteen seconds of a film is a real number that
 * means very little, and the panel would be showing it to somebody who is still
 * deciding whether the feature works.
 */
const MIN_SECONDS = 20;

/** How often the estimate is recomputed, in seconds listened, while converging. */
const RECOMPUTE_EVERY = 1;

/**
 * How often it is recomputed once an offset is already in effect.
 *
 * The slow beat of the whole feature, and the one number that decides whether
 * this is a background whisper or a tax. Fifteen seconds of film is far more
 * than enough for a drifting file to move by the amount that matters, and it is
 * about a fifteenth of the work of the converging cadence — which is what makes
 * a session that runs for a three-hour film reasonable to leave on.
 */
const RECHECK_SECONDS = 15;

/**
 * How far a fresh estimate must differ from the one in effect before it is
 * applied. Inside this, the two are the same answer arrived at twice.
 */
const REAPPLY_SECONDS = 0.25;

/**
 * A jump in the media clock this large is a seek rather than playback, and a
 * seek is the one thing that makes the estimate in hand worth re-deriving now
 * rather than on the next fifteen-second beat.
 */
const SEEK_SECONDS = 2;

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
 *            manualOverride: () => void}}
 *          `status` is `idle` | `live` | `done` | `unclear` | `unsupported`.
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

  /**
   * Puts `answer` into effect, and keeps the session running.
   *
   * Not finishing here is the whole difference between this and a one-shot sync.
   * The session has measured a shift and handed it over; it has not answered a
   * question and closed. So the loop stays up, the window keeps sliding, and the
   * next time the film has moved out from under this answer — a drift, a seek,
   * or a first guess that was wrong — the machinery is already there to catch it.
   *
   * `settled` is cleared so the next correction has to earn its place the same
   * way this one did, rather than being applied off the back of an estimate that
   * has already been spent.
   */
  const apply = useCallback((running, answer) => {
    latest.current.onApply?.(answer.offset);

    running.appliedOffset = answer.offset;
    running.forceCheck = false;
    running.settled = null;

    setState({
      status: 'live',
      seconds: running.elapsed,
      offset: answer.offset,
      score: answer.score,
    });
  }, []);

  /**
   * What the panel shows while a session is running.
   *
   * Called on the same beat as the estimate, and deliberately not from inside
   * it. The first estimate is not ready for twenty seconds, and while this lived
   * at the end of `recompute` — behind that gate — the panel sat on "0s in" for
   * the whole of it. That does not read as a feature that is listening and has
   * nothing yet; it reads as a feature that has not started.
   *
   * The offset holds its last good value rather than dropping back to zero when
   * the correlation dips, for the same reason: the reading is a settled thing
   * and the maths under it is not.
   */
  const publish = useCallback((running) => {
    setState({
      status: 'live',
      seconds: running.elapsed,
      offset: running.appliedOffset ?? running.lastShown?.offset ?? null,
      score: running.latest?.score ?? 0,
    });
  }, []);

  /**
   * Reads the audio and re-estimates, about once a second while converging and
   * every `RECHECK_SECONDS` once something is in effect.
   *
   * Recomputing on a beat rather than every frame is not only about cost —
   * though it is mostly about cost, since it is a few hundred correlations on
   * the main thread and the viewer is watching a film. It is also that the
   * answer barely moves between one second and the next, and a number that
   * jitters on screen reads as a number that is not sure of itself.
   */
  const recompute = useCallback((running) => {
    const { cues: track } = latest.current;

    // Nothing to line up against — the track was turned off under a running
    // session, or the file parsed to nothing. A live session has no answer to
    // give with nothing to compare against, so it ends and says what it had.
    if (!track?.length) {
      const had = running.appliedOffset;
      finish();
      setState({
        status: had == null ? 'unclear' : 'done',
        seconds: running.elapsed,
        offset: had ?? null,
        score: running.latest?.score ?? 0,
      });
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
      // A settled answer is only worth applying if it is a *new* answer. While
      // it agrees with the offset already in effect — which is the common case
      // in the steady state of a well-timed film — there is nothing to do, and
      // re-applying the same number every fifteen seconds would only re-key the
      // overlay for no reason.
      const applied = running.appliedOffset;
      if (applied == null || Math.abs(running.latest.offset - applied) > REAPPLY_SECONDS) {
        apply(running, running.latest);
        return;
      }
      running.settled = null;
    }

    // While the score dips, the number on screen holds its last good value
    // rather than dropping to zero and climbing again: the reading is a settled
    // thing and the correlation under it is not. Publishing is the caller's
    // job — see `tick` — so that it happens whether or not there was an estimate
    // to publish.
    if (running.latest) running.lastShown = running.latest;
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
    // run.
    //
    // Capped per tick, so a seek is not counted as an hour of listening.
    const delta = at - running.lastAt;
    running.lastAt = at;
    if (delta > 0) running.elapsed += Math.min(delta, RECOMPUTE_EVERY);

    // A jump this large is the viewer moving through the film, not the film
    // advancing. The window will fill with the new stretch and the next estimate
    // will be of *that* stretch, so it is worth having now rather than in
    // fifteen seconds — it is the difference between a corrected subtitle and a
    // wrong one across the whole of the scene after a jump.
    if (Math.abs(delta) > SEEK_SECONDS) running.forceCheck = true;

    // A different track is a different question — its own timings, its own
    // offset — so the settled estimate is dropped and the next one is derived
    // at once. The audio already gathered is kept: it is still this film.
    const { cues: track } = latest.current;
    if (track !== running.cuesSeen) {
      running.cuesSeen = track;
      running.settled = null;
      running.forceCheck = true;
    }

    let index = Math.floor((at - running.origin) / BIN_SECONDS);

    if (index >= CAPACITY) {
      const drop = CAPACITY - WINDOW_BINS;

      if (index - drop >= CAPACITY) {
        // Too far to slide to. History from the other side of a jump like that
        // is not the same stretch of film as where the viewer now is, so it is
        // dropped rather than carried across, and the session starts again from
        // here — which the counting above then reports honestly as a restart.
        // The applied offset is deliberately *not* cleared: it is a property of
        // the file, not of this stretch of film, and the subtitles stay where
        // they were while the new stretch is measured.
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
        running.forceCheck = true;
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

    // One offset in effect is a settled thing and needs only a slow second look;
    // converging needs the fast one. A seek or a track change overrides both.
    const cadence = running.appliedOffset == null ? RECOMPUTE_EVERY : RECHECK_SECONDS;
    if (!running.forceCheck && running.elapsed - running.lastCheck < cadence) return;
    running.forceCheck = false;
    running.lastCheck = running.elapsed;

    // A context can be suspended under us — a backgrounded tab, an audio
    // interruption — and a suspended context measures nothing at all.
    resume(running.graph);
    recompute(running);

    // Still running: `recompute` may have ended the session, and that has
    // already said its piece. This is the counter, and it moves from the first
    // second rather than the twentieth — it is the only thing on the panel that
    // tells the viewer anything is happening at all.
    if (session.current === running) publish(running);
  }, [publish, recompute]);

  /** Opens a session and starts listening. */
  const start = useCallback(() => {
    const { video: element, cues: track } = latest.current;
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
      appliedOffset: null,
      cuesSeen: track,
      forceCheck: true,
    };

    setState({ status: 'live', seconds: 0, offset: null, score: 0 });
    tick(session.current);
  }, [finish, tick]);

  /**
   * Ends the session, leaving the offset that is in effect right where it is.
   *
   * Stopping is not undoing. The viewer who presses Stop has listened for as
   * long as they intend to and the subtitles are already where the feature put
   * them; if it never found anything to put them anywhere, that is said rather
   * than shown as a zero offset that was never applied.
   */
  const stop = useCallback(() => {
    const running = finish();
    if (!running) return;

    const applied = running.appliedOffset;
    setState({
      status: applied == null ? 'unclear' : 'done',
      seconds: running.elapsed,
      offset: applied ?? null,
      score: running.latest?.score ?? 0,
    });
  }, [finish]);

  /**
   * Ends the session because the viewer has taken the delay by hand.
   *
   * Deliberately silent, and deliberately not a correction: the stepper is the
   * viewer overruling the machine, and the one thing that must not happen is the
   * machine applying its own answer on the way out. Left at `done` when an
   * offset was in effect, because one still is; left at `idle` when none was,
   * because nothing happened worth reporting.
   */
  const manualOverride = useCallback(() => {
    const running = finish();
    if (!running) return;

    const applied = running.appliedOffset;
    setState(
      applied == null
        ? { status: 'idle', seconds: 0, offset: null, score: 0 }
        : { status: 'done', seconds: running.elapsed, offset: applied, score: running.latest?.score ?? 0 },
    );
  }, [finish]);

  // A session that is still listening when the player goes away would keep an
  // animation frame loop alive against a detached element. The graph itself is
  // deliberately not torn down — it belongs to the element, and it cannot be.
  useEffect(() => finish, [finish]);

  // The same is true of the element being replaced under a running session: the
  // loop would go on reading a node nobody is watching any more. Ended rather
  // than carried over, because the offset is a property of the file that was
  // playing on the element that is gone.
  const elementSeen = useRef(video);
  useEffect(() => {
    if (elementSeen.current === video) return;
    elementSeen.current = video;
    if (finish()) setState({ status: 'idle', seconds: 0, offset: null, score: 0 });
  }, [video, finish]);

  return { ...state, start, stop, manualOverride };
}
