/**
 * ============================================================================
 *  SUBTITLE ADVERTS
 * ============================================================================
 *
 *  Subtitle files arrive with advertising stapled into them, and it is the same
 *  trick from every source: a cue that is not dialogue, sitting at a timestamp
 *  where nobody is talking, naming a website.
 *
 *  Wyzie's free tier inserts a card at zero to six seconds — "You're on the free
 *  plan. Unlock every source, AI translation & ad-free subs → store.wyzie.io".
 *  The provider subtitles carry two of their own, at the start and at the very
 *  end, reading "Visit hoofoot.ru to watch all sports livestream and highlights
 *  for free". Two, out of two thousand and forty-five cues.
 *
 *  This matters more than it sounds. These files are not shown to anyone — they
 *  are what gets *translated*, and the translated file is what the viewer reads.
 *  An ad that nobody would have seen in English comes back as a Sorani sentence
 *  advertising someone else's site, at the top of every film on the site. It also
 *  spends a translate request on it.
 *
 *  ---------------------------------------------------------------------------
 *  Why the rule is a domain rather than a list of domains
 *  ---------------------------------------------------------------------------
 *
 *  A list would have to be extended every time a source changes its mind, and the
 *  failure is silent when it is not — the advert simply appears. The marker is
 *  the thing every one of these has in common and the thing dialogue almost never
 *  has: a bare domain name. `store.wyzie.io` and `hoofoot.ru` are both matched by
 *  it, so one rule covers what used to be two.
 *
 *  The cost of being wrong is bounded and small: a line of dialogue that spells
 *  out a web address is dropped from a translation. The cost of not having it is
 *  an advert in every subtitle on the site.
 * ============================================================================
 */

/** VTT cues are blank-line separated, so a block is one cue — never half of one. */
const BLOCK_BREAK = /\r?\n[ \t]*\r?\n/;

/**
 * A domain, with any common ending.
 *
 * The endings are listed rather than inferred for the same reason the check
 * exists: `\.[a-z]{2,}` would match the end of an ordinary sentence — "etc." and
 * "Mr." and every abbreviation a subtitle is full of — and would quietly start
 * eating dialogue.
 */
const PROMO =
  /\b[a-z0-9-]+\.(?:com|net|org|io|ru|to|cc|tv|me|site|xyz|live|info|app|store|online|club)\b/i;

/**
 * The file, with any cue naming a website removed.
 *
 * Returns the original string when nothing matched, so a file with no adverts in
 * it is not rebuilt — the caller can compare by identity, and a subtitle with
 * nothing to strip comes through byte for byte.
 */
export function stripPromoCues(vtt) {
  const blocks = String(vtt ?? '').split(BLOCK_BREAK);
  const kept = blocks.filter((block) => !PROMO.test(block));

  return kept.length === blocks.length ? vtt : kept.join('\n\n');
}
