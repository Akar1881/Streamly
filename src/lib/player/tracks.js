/**
 * ============================================================================
 *  SUBTITLE TRACK LISTS
 * ============================================================================
 *  A provider hands back a great many subtitle tracks — one popular film came
 *  back with 106 — and two of them usually say the same thing. This is where
 *  that list is made fit to put in front of somebody.
 *
 *  It is a module rather than a few lines inside the player because both halves
 *  of it are decisions worth being able to point at: what counts as a duplicate,
 *  and which of the pile is the right one to translate.
 * ============================================================================
 */

/**
 * A label reduced to the thing it is actually naming.
 *
 * The duplicates a provider sends are spelled out rather than collapsed —
 * `Arabic`, `Arabic2`, `Arabic3`, `Arabic4`, `Arabic5` are five separate files
 * for one language — so the trailing counter has to come off for them to look
 * like what they are. Case and spacing differ between providers for the same
 * language too, and neither is a distinction anyone chose.
 *
 * A trailing number is only ever a counter here. No subtitle is called `Arabic
 * 2` because it is the second one anyone wants.
 */
function trackKey(label) {
  return String(label ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim()
    .replace(/ ?\d+$/, '');
}

/**
 * The list as a viewer should see it: one entry per language, in the order the
 * provider chose.
 *
 * First wins. The provider's own order is by relevance, and a later file for a
 * language already listed is the one further down that list — nothing here
 * knows better than it does.
 */
export function dedupeTracks(tracks) {
  const seen = new Set();
  const kept = [];

  for (const track of tracks) {
    if (typeof track?.src !== 'string' || !track.src) continue;

    const key = trackKey(track.label);
    if (seen.has(key)) continue;

    seen.add(key);
    kept.push(track);
  }

  return kept;
}

/**
 * Labels that say "hearing impaired" in the several ways providers spell it.
 *
 * Worth separating because the difference is not cosmetic when the file is
 * about to be translated: an HI track carries sound descriptions — `[door
 * slams]`, `[tense music]` — and those are noise in a translated subtitle,
 * where they are helpful in an original-language one. Wyzie's own picker makes
 * the same call for the same reason; see `pickResult` in `subtitles/wyzie.js`.
 */
const HEARING_IMPAIRED = /\b(hi|sdh|hearing)\b/i;

/**
 * The track to translate, out of everything a provider offered.
 *
 * Matched on the start of the label rather than on a language code, because
 * there is no code to match on: providers send the name of the language as
 * they chose to write it. A prefix is what makes `English` match `English`,
 * `English (US)` and `English2` without also matching `Bengali`.
 *
 * @param {{label?: string, src?: string}[]} tracks
 * @param {string} languageLabel  the configured source language, as a word
 * @returns {{label?: string, src: string}|null}
 */
export function pickSourceTrack(tracks, languageLabel) {
  const wanted = String(languageLabel ?? '').trim().toLowerCase();
  if (!wanted) return null;

  const matches = tracks.filter((track) =>
    String(track?.label ?? '').toLowerCase().startsWith(wanted),
  );
  if (matches.length === 0) return null;

  // The clean one if there is one, otherwise whatever came first — a hearing-
  // impaired file is a worse translation source, not an unusable one.
  return matches.find((track) => !HEARING_IMPAIRED.test(String(track.label))) ?? matches[0];
}
