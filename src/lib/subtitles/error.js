/**
 * ============================================================================
 *  SUBTITLE ERRORS
 * ============================================================================
 *
 *  Everything that can go wrong while preparing a subtitle ends up as one of
 *  these, carrying a `code` rather than a message the UI would have to pattern
 *  match on. The waiting screen maps the code to wording, and — more
 *  importantly — every code is survivable: the caller plays the video without
 *  subtitles instead of showing an error.
 *
 *  Same shape as `TmdbError` in src/lib/tmdb/client.js.
 * ============================================================================
 */

/**
 * Why a subtitle could not be prepared.
 *
 *   limit            a daily quota or rate limit was hit (Wyzie's key, or the
 *                    translator's). `resetAt` says when it frees up, when the
 *                    provider told us.
 *   not-found        nobody has an English subtitle for this title.
 *   fetch-failed     the subtitle source could not be reached or parsed.
 *   translate-failed the translator answered, but not with something usable.
 *   timeout          the job ran past `subtitles.timeoutMs`.
 *   unavailable      the feature is off, or a key is missing.
 */
export class SubtitleError extends Error {
  constructor(message, code, { status, resetAt } = {}) {
    super(message);
    this.name = 'SubtitleError';
    this.code = code;
    this.status = status;
    this.resetAt = resetAt ?? null;
  }
}

/** True when the failure is a quota, which is worth wording differently. */
export function isLimit(error) {
  return error instanceof SubtitleError && error.code === 'limit';
}
