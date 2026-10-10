/**
 * ============================================================================
 *  PLAYER — subtitle cues
 * ============================================================================
 *  Parsing a track and finding the cue that belongs to a moment in time.
 *
 *  The parsing is not here: `parseSubtitle` in `src/lib/subtitles/srt.js` already
 *  reads both SubRip and WebVTT, strips ASS positioning tags, and flattens a cue
 *  that wraps across two lines into one string. That last part is exactly what a
 *  player wants — the line break was a decision made for a different width, and
 *  the overlay re-wraps to whatever the viewer's settings say.
 *
 *  What is here is the lookup, which runs on every animation frame while the
 *  video plays and so cannot afford to scan the list.
 * ============================================================================
 */

import { parseSubtitle } from '@/lib/subtitles/srt';

/** Ranges that read right-to-left. Kurdish (Sorani) is the one that matters here. */
const RTL = /[֐-׿؀-ۿ܀-ݏݐ-ݿיִ-﷿ﹰ-﻿]/;

/**
 * Inline markup inside a cue: WebVTT's `<i>`, `<b>`, `<c.classname>` and friends,
 * and the `<font>` tags that turn up in files converted from older formats.
 *
 * Stripped rather than rendered. These are display instructions from the file's
 * original author, and this player's whole appearance — font, size, colour,
 * edge, position — is the viewer's decision, not the file's. A cue that forced
 * itself italic and yellow would be fighting the panel. Left in place they would
 * be worse still: the text is rendered as text, so `<i>` would appear on screen
 * as the four literal characters.
 *
 * Only the player does this. `parseSubtitle` is shared with the translation
 * pipeline, which must hand the translator what the file actually says.
 */
const INLINE_TAG = /<\/?[a-zA-Z][^>]*>/g;

/**
 * Turns a subtitle file into cues, sorted by start time.
 *
 * Sorting is not cosmetic: `cueAt` is a binary search and depends on it. Files
 * are almost always already ordered, but "almost" is not a guarantee — and an
 * out-of-order file would silently return the wrong line for part of the film
 * rather than fail visibly.
 *
 * @param {string} text  the raw file, SRT or WebVTT
 * @returns {{ startMs: number, endMs: number, text: string }[]}
 */
export function parseTrack(text) {
  return parseSubtitle(text)
    .map((cue) => ({ ...cue, text: cue.text.replace(INLINE_TAG, '').trim() }))
    .filter((cue) => cue.text)
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Whether a line should be laid out right-to-left.
 *
 * Decided per cue rather than per track. A Kurdish subtitle track still carries
 * untranslated fragments, and a `[MUSIC]` cue is Latin whatever the track's
 * language is — anchoring those to the right edge would be wrong.
 */
export function isRtl(text) {
  return RTL.test(text ?? '');
}

/**
 * The cue on screen at `seconds`, or null.
 *
 * A binary search for the last cue that has started, then a check that it has
 * not finished. A linear scan would also work and is what this replaces: the
 * overlay calls this once per animation frame, and a feature-length track is a
 * few thousand cues.
 *
 * `seconds` is expected to already have the viewer's subtitle delay taken out of
 * it — the offset is applied to the query, never to the cue list, so changing
 * the delay cannot corrupt the timings that were parsed. The sign belongs to the
 * caller and is stated there: the overlay looks up `time - delay`, so a positive
 * delay is a subtitle that appears later. See the header of `sync.js`, which is
 * the other place that has to agree.
 *
 * @param {{ startMs: number, endMs: number, text: string }[]} cues  sorted by `startMs`
 * @param {number} seconds
 * @returns {{ startMs: number, endMs: number, text: string }|null}
 */
export function cueAt(cues, seconds) {
  if (!Array.isArray(cues) || !cues.length || !Number.isFinite(seconds)) return null;

  const ms = seconds * 1000;

  // Index of the first cue starting after `ms`; the candidate is the one before.
  let low = 0;
  let high = cues.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;

    if (cues[middle].startMs <= ms) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (found === -1) return null;

  const cue = cues[found];
  return ms < cue.endMs ? cue : null;
}
