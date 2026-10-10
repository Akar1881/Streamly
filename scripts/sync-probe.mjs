#!/usr/bin/env node
/**
 * ============================================================================
 *  SYNC PROBE  (development helper — not part of the app)
 * ============================================================================
 *
 *  Checks the subtitle-to-audio solver against signals whose offset is known:
 *
 *    node scripts/sync-probe.mjs
 *
 *  There is no test runner in this repo, and the solver is the one part of the
 *  feature that cannot be judged by looking at the player — a wrong answer there
 *  moves every subtitle in the film, and a plausible wrong answer is worse than
 *  an obvious one. So it is fed a synthetic film: cues at random places, an
 *  audio envelope built *from* those cues at a known shift, and noise on top.
 *  The solver is handed the two signals the way `useAudioSync` builds them and
 *  has to recover the shift it was never told.
 *
 *  It imports the real module rather than a copy of it, which is why `sync.js`
 *  has no imports of its own — the `@/` aliases the rest of `src/lib` uses are
 *  not something Node resolves. See `subtitle-probe.mjs` for the other half of
 *  that trade-off.
 * ============================================================================
 */

import {
  BIN_SECONDS,
  MAX_LAG_SECONDS,
  activitySignal,
  alignOffset,
} from '../src/lib/player/sync.js';

/** Deterministic noise, so a failure can be reproduced. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A synthetic film: a subtitle track as runs of on and off, returned as cues.
 *
 * Runs rather than evenly spaced cues, because evenly spaced anything correlates
 * with a shifted copy of itself and would make the solver look better than it is.
 */
function makeCues(seconds, random, { duty = 0.6 } = {}) {
  const cues = [];
  let at = random() * 2;

  while (at < seconds) {
    const on = 0.8 + random() * 3.2;
    cues.push({ startMs: at * 1000, endMs: (at + on) * 1000, text: 'x' });
    at += on + (on * (1 - duty)) / duty + random() * 1.5;
  }

  return cues;
}

/**
 * The audio's loudness envelope for a window of the media, given the true offset.
 *
 * A cue on screen means speech, so the envelope is built from the activity
 * signal *shifted by the offset* — the audio at media time `t` is loud where the
 * file has a cue at `t - offset`. Noise is added on top, and separately scaled,
 * because a real envelope is never a clean copy of the subtitle track.
 */
function makeAudio(cues, { from, count, offset, noise, random, gain = 1 }) {
  const dt = BIN_SECONDS;
  const lead = Math.round(MAX_LAG_SECONDS / dt);

  // Activity over the padded file window, so the shift can be taken either way.
  const padded = activitySignal(
    cues,
    from - MAX_LAG_SECONDS,
    count + 2 * lead,
    dt,
  );

  const audio = new Float32Array(count);
  const mask = new Uint8Array(count);

  let speech = 0.35 + random() * 0.1;
  let music = 0.12 + random() * 0.05;

  for (let index = 0; index < count; index += 1) {
    // The file bin that lines up with this moment in the media.
    const source = padded[index + lead - Math.round(offset / dt)] ?? 0;

    // Speech drifts in level the way dialogue does; music never stops.
    speech = Math.max(0.2, Math.min(0.7, speech + (random() - 0.5) * 0.05));
    music = Math.max(0.05, Math.min(0.25, music + (random() - 0.5) * 0.02));

    const level = source ? speech : music;
    audio[index] = gain * level + (random() - 0.5) * noise;
    mask[index] = 1;
  }

  return { audio, mask, padded, lead };
}

/**
 * A pause or a seek: bins nobody listened to.
 *
 * Their zeros are not silence in the film, and counting them as silence is the
 * mistake the mask exists to prevent, so they are worth exercising.
 */
function punchHoles(mask, random, holes = 3) {
  const copied = Uint8Array.from(mask);

  for (let n = 0; n < holes; n += 1) {
    const at = Math.floor(random() * (copied.length - 100));
    const width = 20 + Math.floor(random() * 120);
    for (let index = at; index < at + width && index < copied.length; index += 1) {
      copied[index] = 0;
    }
  }

  return copied;
}

let failures = 0;

function report(ok, label, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
}

/* -------------------------------------------------------------------------- */
/*  1. A known offset, across the range worth searching                        */
/* -------------------------------------------------------------------------- */

console.log('\nRecovering a known offset (60 s of audio, subtle noise)\n');

for (const offset of [0, 0.5, -0.5, 2, -2, 7.25, -11, 21, -29]) {
  const random = makeRandom(20261010 + Math.round(offset * 100));
  const cues = makeCues(400, random);
  const count = Math.round(60 / BIN_SECONDS);
  const { audio, mask, padded, lead } = makeAudio(cues, {
    from: 120,
    count,
    offset,
    noise: 0.06,
    random,
  });

  const found = alignOffset(audio, padded, {
    binSeconds: BIN_SECONDS,
    lead,
    mask,
  });

  const error = found ? found.offset - offset : null;
  report(
    found !== null && Math.abs(error) <= 0.35,
    `offset ${offset >= 0 ? '+' : ''}${offset}s`,
    found
      ? `recovered ${found.offset.toFixed(2)}s (error ${error.toFixed(2)}s, r ${found.score.toFixed(2)}, contrast ${found.contrast.toFixed(2)})`
      : 'no result',
  );
}

/* -------------------------------------------------------------------------- */
/*  2. Pauses and seeks                                                        */
/* -------------------------------------------------------------------------- */

console.log('\nWith bins nobody listened to\n');

{
  const random = makeRandom(771);
  const cues = makeCues(400, random);
  const count = Math.round(60 / BIN_SECONDS);
  const { audio, mask, padded, lead } = makeAudio(cues, {
    from: 120,
    count,
    offset: 3,
    noise: 0.06,
    random,
  });

  const found = alignOffset(audio, padded, {
    binSeconds: BIN_SECONDS,
    lead,
    mask: punchHoles(mask, random),
  });

  report(
    found !== null && Math.abs(found.offset - 3) <= 0.35,
    'holes in the listening',
    found ? `recovered ${found.offset.toFixed(2)}s` : 'no result',
  );
}

/* -------------------------------------------------------------------------- */
/*  3. Window length — how long a viewer has to listen                         */
/* -------------------------------------------------------------------------- */

console.log('\nAccuracy against how long sync listened\n');

// Ten seconds is below the module's own floor on how much audio is worth
// correlating, and refusing to answer is the right result there — a level
// reading from ten seconds of a film is a coin toss that looks like a number.
for (const [seconds, expectAnswer] of [
  [10, false],
  [20, true],
  [30, true],
  [45, true],
  [60, true],
  [90, true],
]) {
  const random = makeRandom(4242);
  const cues = makeCues(400, random);
  const count = Math.round(seconds / BIN_SECONDS);
  const { audio, mask, padded, lead } = makeAudio(cues, {
    from: 120,
    count,
    offset: 4.5,
    noise: 0.08,
    random,
  });

  const found = alignOffset(audio, padded, { binSeconds: BIN_SECONDS, lead, mask });

  if (!expectAnswer) {
    report(found === null, `${seconds}s`, 'refuses to answer, as it should');
    continue;
  }

  report(
    found !== null && Math.abs(found.offset - 4.5) <= 0.35,
    `${seconds}s`,
    found
      ? `recovered ${found.offset.toFixed(2)}s (error ${(found.offset - 4.5).toFixed(2)}s, r ${found.score.toFixed(2)})`
      : 'no result',
  );
}

/* -------------------------------------------------------------------------- */
/*  4. The case that must not produce an answer                                */
/* -------------------------------------------------------------------------- */

console.log('\nAudio that has nothing to do with the subtitles\n');

{
  const random = makeRandom(31337);
  const cues = makeCues(400, random);
  const count = Math.round(60 / BIN_SECONDS);

  // Loudness that ignores the cues entirely — a music cue, an action scene.
  const audio = new Float32Array(count);
  const mask = new Uint8Array(count);
  let level = 0.3;
  for (let index = 0; index < count; index += 1) {
    level = Math.max(0.1, Math.min(0.6, level + (random() - 0.5) * 0.02));
    audio[index] = level + (random() - 0.5) * 0.3;
    mask[index] = 1;
  }

  const lead = Math.round(MAX_LAG_SECONDS / BIN_SECONDS);
  const padded = activitySignal(cues, 120 - MAX_LAG_SECONDS, count + 2 * lead, BIN_SECONDS);
  const found = alignOffset(audio, padded, { binSeconds: BIN_SECONDS, lead, mask });

  // A result is allowed — there is always a best lag — but it must announce
  // itself as weak, which is the only thing standing between a viewer and a
  // confident wrong answer.
  report(
    found === null || found.score < 0.25,
    'unrelated audio scores low',
    found ? `r ${found.score.toFixed(2)}, contrast ${found.contrast.toFixed(2)}` : 'no result',
  );
}

/* -------------------------------------------------------------------------- */
/*  5. Nothing to correlate                                                    */
/* -------------------------------------------------------------------------- */

console.log('\nDegenerate inputs\n');

{
  const silence = new Float32Array(1200);
  const flat = new Float32Array(1200 + 2 * Math.round(MAX_LAG_SECONDS / BIN_SECONDS)).fill(1);
  const lead = Math.round(MAX_LAG_SECONDS / BIN_SECONDS);

  report(
    alignOffset(silence, flat, { lead }) === null,
    'silence and a track that never ends',
  );

  report(
    alignOffset(new Float32Array(10), new Float32Array(10), {}) === null,
    'ten bins is not enough to say anything',
  );
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
