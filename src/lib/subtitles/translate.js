/**
 * ============================================================================
 *  TRANSLATION — Google's translate endpoint
 * ============================================================================
 *
 *  Translates cues in batches and hands back a translated cue per input cue.
 *
 *  The awkward part, and the reason this file is longer than "build a URL and
 *  fetch it", is line alignment. The endpoint translates *text*, not a list of
 *  lines, so nothing in the request says "keep these 60 lines separate" — we
 *  send the batch's cues joined by newlines and have to work out from the
 *  response which translated words belong to which cue. Get that wrong and the
 *  subtitles are not mis-translated, they are *mis-timed*: every line after the
 *  slip sits under the wrong shot, which is worse than having no subtitle.
 *
 *  So each batch is verified. If the response cannot be lined up with the cues
 *  that were sent, that batch is re-done one cue at a time — correct on the
 *  second pass, at the cost of the extra requests. Correct subtitles that cost
 *  more are worth more than cheap corrupt ones.
 * ============================================================================
 */

import site from '@config/site';
import { SubtitleError } from './error';

const ENDPOINT = 'https://translate-pa.googleapis.com/v1/translate';

/** The key, or null when the feature is not configured. */
export function translateKey() {
  return process.env.TRANSLATE_API_KEY?.trim() || null;
}

/**
 * Pulls the translated text out of a response, keeping its line structure.
 *
 * The exact JSON this endpoint returns is not documented, so rather than pin a
 * guess the known spellings are all accepted and the result is the list of
 * pieces it sent, in order. Which piece is which line is decided later, by
 * `align` — so this deliberately does not join them.
 *
 * @returns {string[]} translated fragments, in the order the API returned them
 */
function readPieces(data) {
  if (Array.isArray(data?.sentences)) {
    return data.sentences
      .map((sentence) => sentence?.trans ?? sentence?.translatedText ?? sentence?.text)
      .filter((piece) => typeof piece === 'string');
  }

  if (Array.isArray(data?.translations)) {
    return data.translations
      .map((entry) => entry?.translatedText ?? entry?.text ?? entry?.trans)
      .filter((piece) => typeof piece === 'string');
  }

  const single = data?.translation ?? data?.translatedText;
  if (typeof single === 'string') return [single];

  return [];
}

/**
 * Works out which translated piece belongs to which cue.
 *
 * Two shapes are plausible from a line-joined request, so both are tried: the
 * API splitting the batch into one piece per line, or returning fewer pieces
 * with the line breaks still inside them. Anything else means we cannot trust
 * the alignment and the caller has to fall back.
 *
 * @returns {string[]|null} one translation per cue, or null if it did not line up
 */
function align(pieces, cueCount) {
  const candidates = [pieces, pieces.join('').split('\n')];

  for (const candidate of candidates) {
    if (candidate.length !== cueCount) continue;

    const texts = candidate.map((piece) => piece.trim());

    // An empty line where there was dialogue is a dropped line, not a
    // translation of one — treat the batch as unaligned rather than emit a
    // cue with no text.
    if (texts.some((text) => !text)) continue;

    return texts;
  }

  return null;
}

/** One request. `text` may hold many cue lines, joined by newlines. */
async function requestTranslation(text, { source, target }) {
  const key = translateKey();
  if (!key) throw new SubtitleError('No translate API key configured', 'unavailable');

  const params = new URLSearchParams();
  params.set('params.client', 'gtx');
  params.set('query.source_language', source);
  params.set('query.target_language', target);
  params.set('query.display_language', 'en-US');
  params.set('query.text', text);
  params.set('key', key);
  // Repeated, not comma-joined: the API reads this as a list of data types.
  params.append('data_types', 'TRANSLATION');
  params.append('data_types', 'SENTENCE_SPLITS');
  params.append('data_types', 'BILINGUAL_DICTIONARY_FULL');

  let response;
  try {
    response = await fetch(`${ENDPOINT}?${params}`, { method: 'GET' });
  } catch (error) {
    throw new SubtitleError(error?.message ?? 'Could not reach the translator', 'translate-failed');
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new SubtitleError('Translation quota reached', 'limit', {
        status: 429,
        resetAt: response.headers.get('retry-after'),
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new SubtitleError('Translator rejected the API key', 'unavailable', {
        status: response.status,
      });
    }

    throw new SubtitleError(`Translator failed (${response.status})`, 'translate-failed', {
      status: response.status,
    });
  }

  const data = await response.json().catch(() => null);
  const pieces = readPieces(data);

  if (!pieces.length) {
    // The one failure mode that means *our* guess about the response shape was
    // wrong, rather than the API being unhappy. The body is logged so the next
    // person can fix `readPieces` in one line instead of guessing blind.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[subtitles] unrecognised translation response:',
        JSON.stringify(data)?.slice(0, 500),
      );
    }
    throw new SubtitleError('Translator returned nothing usable', 'translate-failed');
  }

  return pieces;
}

/** Runs `worker` over `items`, `limit` at a time, preserving order. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);

  return results;
}

/** Groups cues into batches of at most `batchChars` characters. */
function batchCues(cues, batchChars) {
  const batches = [];
  let current = [];
  let size = 0;

  for (const cue of cues) {
    // A single cue longer than the budget still gets its own batch rather than
    // being split — a cue is the smallest unit we can translate.
    if (current.length && size + cue.text.length > batchChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(cue);
    size += cue.text.length + 1;
  }

  if (current.length) batches.push(current);

  return batches;
}

/**
 * Translates cues, returning one translated string per cue in the same order.
 *
 * @param {{ startMs: number, endMs: number, text: string }[]} cues
 * @param {object} [options]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<string[]>}
 * @throws {SubtitleError}
 */
export async function translateCues(cues, { onProgress } = {}) {
  const { batchChars, concurrency } = site.subtitles;
  const source = site.subtitles.sourceLanguage;
  const target = site.subtitles.target.code;

  const batches = batchCues(cues, batchChars);
  let done = 0;

  const translated = await mapLimit(batches, concurrency, async (batch) => {
    const joined = batch.map((cue) => cue.text).join('\n');
    const pieces = await requestTranslation(joined, { source, target });

    let texts = align(pieces, batch.length);

    if (!texts) {
      // The response did not line up with what was sent. Re-do this batch a cue
      // at a time: slower, more requests, and the only way to be sure the
      // words land on the right cue.
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[subtitles] batch of ${batch.length} did not align (${pieces.length} pieces back) — retrying one cue at a time`,
        );
      }

      texts = await mapLimit(batch, concurrency, async (cue) => {
        const single = await requestTranslation(cue.text, { source, target });
        return single.join(' ').trim();
      });
    }

    done += batch.length;
    onProgress?.(done, cues.length);

    return texts;
  });

  return translated.flat();
}
