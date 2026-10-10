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

/* -------------------------------------------------------------------------- */
/*  WHICH TRACK TURNS ITSELF ON                                               */
/* -------------------------------------------------------------------------- */

/**
 * The index of the track that names a language, or `-1` for none.
 *
 * Matched on the label rather than on a language code, for the same reason
 * `pickSourceTrack` is: providers name languages the way they please and there
 * is no code to trust. An exact match wins, and a label that *starts with* the
 * name is the fallback, so a remembered `English` still finds `English (US)`
 * and `English2` on a title whose provider spells it differently from the one
 * the viewer chose on.
 */
function labelIndex(tracks, label) {
  const wanted = String(label ?? '').trim().toLowerCase();
  if (!wanted) return -1;

  const same = (value) => String(value?.label ?? '').trim().toLowerCase();

  const exact = tracks.findIndex((track) => same(track) === wanted);
  if (exact >= 0) return exact;

  return tracks.findIndex((track) => same(track).startsWith(wanted));
}

/**
 * The track the player turns on by itself, as an index into `tracks`, or `-1`
 * to leave captions off.
 *
 * In order, and the order is the whole of it:
 *
 *   1. What the viewer chose last time, if this title offers that language.
 *      `preference` is `{ label }` for a language and `{ label: null }` for
 *      captions switched off deliberately — a choice like any other, and the
 *      one to keep. `null` means they have not chosen yet.
 *   2. The first of `preferredLabels` the title has — the site's own languages,
 *      best first.
 *   3. Whatever the list marks as `default`, which is how a provider or the
 *      site nominates one.
 *
 * Nothing matched is `-1`, not index 0: turning on a subtitle file in a
 * language nobody asked for is not a default, it is a surprise.
 *
 * @param {{label?: string, src?: string, default?: boolean}[]} tracks
 * @param {{label: string|null}|null} preference  the viewer's stored choice
 * @param {string[]} [preferredLabels]  the site's languages, best first
 */
export function pickSubtitleTrack(tracks, preference, preferredLabels = []) {
  if (!tracks.length) return -1;

  if (preference) {
    if (!preference.label) return -1;

    const remembered = labelIndex(tracks, preference.label);
    if (remembered >= 0) return remembered;
  }

  for (const label of preferredLabels) {
    const index = labelIndex(tracks, label);
    if (index >= 0) return index;
  }

  return tracks.findIndex((track) => track.default);
}
