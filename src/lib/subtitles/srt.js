/**
 * ============================================================================
 *  SUBTITLE FILE PARSING
 * ============================================================================
 *
 *  Subtitles arrive as SubRip (.srt) and have to leave as WebVTT, because that
 *  is what a browser <track> element — and so the player — can read.
 *
 *  The text is translated in between, which is the reason this is a real parser
 *  rather than a regex over the whole file: cues have to be split apart so each
 *  one's words can be translated without touching its timings. A translator
 *  handed raw SRT returns mangled timestamps, and a subtitle with mangled
 *  timestamps is worse than none.
 *
 *  Both formats are accepted on the way in — only the milliseconds separator
 *  really differs (`,` in SRT, `.` in WebVTT) — so a source that is already
 *  WebVTT does not need a separate path.
 * ============================================================================
 */

/**
 * `00:01:02,345 --> 00:01:04,000`, and the WebVTT spellings of the same thing.
 *
 * The hours are optional: WebVTT allows `01:02.345`, and some files use it.
 * Anything trailing the end timestamp (WebVTT cue settings like `align:start`)
 * is ignored rather than treated as part of the time.
 */
const TIMING =
  /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{2}):(\d{2})[,.](\d{1,3})/;

/** Milliseconds, from the four timestamp groups, hours optional. */
function toMs(hours, minutes, seconds, fraction) {
  // `fraction` is 1-3 digits: "5" is 500 ms, "50" is 500 ms, "500" is 500 ms.
  const ms = Number(fraction.padEnd(3, '0'));
  return (
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1000 +
    ms
  );
}

/** `01:02:03.004` — always with hours, which WebVTT always accepts. */
export function formatTimestamp(totalMs) {
  const ms = Math.max(0, Math.round(totalMs));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);

  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms % 1000, 3)}`;
}

/**
 * Leading `{\an8}`-style override blocks, which some SRT files carry over from
 * their ASS source. They are positioning instructions, not words, and a
 * translator would happily start translating them.
 */
const ASS_TAG = /\{[^}]*\}/g;

/** The text of a cue, cleaned of the things that should not be translated. */
function cleanText(text) {
  return text
    .replace(ASS_TAG, '')
    // A cue that wraps across lines is one sentence; the break is a display
    // decision, and the translator should see the sentence whole.
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a subtitle file into cues.
 *
 * Blocks are separated by blank lines in both formats. Within a block the
 * timings are found by pattern rather than by position, so the optional SRT
 * index line, a WebVTT cue identifier, or a missing `WEBVTT` header all work
 * without a special case. Blocks with no timings — headers, stray notes — are
 * skipped.
 *
 * @param {string} source  the raw file, in either format
 * @returns {{ startMs: number, endMs: number, text: string }[]}
 */
export function parseSubtitle(source) {
  if (typeof source !== 'string' || !source.trim()) return [];

  const cues = [];

  for (const block of source.replace(/^﻿/, '').split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const timingAt = lines.findIndex((line) => TIMING.test(line.trim()));
    if (timingAt === -1) continue;

    const match = lines[timingAt].trim().match(TIMING);
    const text = cleanText(lines.slice(timingAt + 1).join('\n'));
    if (!text) continue;

    const startMs = toMs(match[1], match[2], match[3], match[4]);
    const endMs = toMs(match[5], match[6], match[7], match[8]);

    // A cue that ends before it starts would break the track; drop it rather
    // than emit something a player may refuse to load.
    if (endMs <= startMs) continue;

    cues.push({ startMs, endMs, text });
  }

  return cues;
}

/**
 * Wraps translated text across at most `maxLines` display lines.
 *
 * Sorani runs longer than the English it came from, so a line that used to fit
 * will not. Text is never dropped to make it fit — once the line budget is
 * spent the last line simply keeps growing, which the player renders fine.
 */
function wrapText(text, maxChars = 42, maxLines = 2) {
  const words = text.split(' ');
  const lines = [];
  let line = '';

  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= maxChars || lines.length === maxLines - 1) {
      // Either it still fits, or this is the last line we are allowed and the
      // rest of the words have nowhere else to go.
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * Renders cues as a WebVTT file.
 *
 * @param {{ startMs: number, endMs: number, text: string }[]} cues
 * @param {object} [options]
 * @param {string} [options.header]  free-text header on the first line
 */
export function toVtt(cues, { header } = {}) {
  const parts = ['WEBVTT'];

  if (header) parts.push(`NOTE ${header}`);

  for (const cue of cues) {
    parts.push(
      `${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}\n${wrapText(cue.text)}`,
    );
  }

  // A trailing newline: some players are fussy about a file that ends mid-cue.
  return `${parts.join('\n\n')}\n`;
}
