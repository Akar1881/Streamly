/**
 * Small, dependency-free formatting helpers used across the UI.
 */

/** 179 -> "2h 59m", 47 -> "47 min", null -> "" */
export function formatRuntime(minutes) {
  if (!minutes || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} min`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/** "2002-12-18" -> "2002" */
export function year(dateString) {
  if (!dateString) return '';
  return String(dateString).slice(0, 4);
}

/** "2022-03-02" -> "02/03/2022" (day/month/year, as on the episode cards) */
export function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

/**
 * Whole days from today to a "YYYY-MM-DD" date. Negative means the date has
 * already passed, 0 means it is today, and null means the string is missing or
 * unparseable.
 *
 * Both ends are compared in UTC so the answer does not shift with the
 * server's timezone — the same build always renders the same countdown.
 */
export function daysUntil(dateString) {
  const match = String(dateString ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return Math.round((target - today) / 86400000);
}

/** "2026-10-16" -> "11 days until air" (today and tomorrow get their own wording). */
export function formatAirCountdown(dateString) {
  const days = daysUntil(dateString);
  if (days === null) return '';
  if (days < 0) return 'Aired';
  if (days === 0) return 'Airs today';
  if (days === 1) return 'Airs tomorrow';
  return `${days} days until air`;
}

/** 42 -> "in 42 days", 1 -> "tomorrow", 0 -> "today", null/past -> "". */
export function formatDaysAway(days) {
  if (days === null || days === undefined || days < 0) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** 7.734 -> "7.7" — TMDB vote averages are noisy, always show one decimal. */
export function formatRating(voteAverage) {
  if (!voteAverage) return '';
  return Number(voteAverage).toFixed(1);
}

/** 7.734 -> 4 (out of 5 stars, rounded to the nearest half) */
export function toStars(voteAverage) {
  if (!voteAverage) return 0;
  return Math.round((Number(voteAverage) / 2) * 2) / 2;
}

/** 1234567 -> "1,234,567" */
export function formatNumber(value) {
  if (value === null || value === undefined) return '';
  return Number(value).toLocaleString('en-US');
}

/** 185000000 -> "$185,000,000" ; 0 or null -> "" */
export function formatMoney(value) {
  if (!value || value <= 0) return '';
  return `$${Number(value).toLocaleString('en-US')}`;
}

/**
 * "The Lord of the Rings: The Two Towers"
 *   -> "the-lord-of-the-rings-the-two-towers"
 *
 * `\p{M}` matches combining marks, so accents are stripped after NFD
 * normalisation ("Amélie" -> "amelie").
 */
export function slugify(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Builds the pretty URL segment used on detail pages: "550-fight-club".
 * Pairs with `parseId` below.
 */
export function toSlugId(id, title) {
  const slug = slugify(title);
  return slug ? `${id}-${slug}` : String(id);
}

/** "550-fight-club" -> 550 ; "550" -> 550 ; garbage -> null */
export function parseId(segment) {
  const match = String(segment ?? '').match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Joins truthy parts with a middot: ["Movie", "2002", "8.4"] -> "Movie · 2002 · 8.4" */
export function joinMeta(parts, separator = ' · ') {
  return parts.filter(Boolean).join(separator);
}

/** Clamps text to a length without cutting mid-word. */
export function truncate(text, max = 180) {
  if (!text || text.length <= max) return text ?? '';
  const cut = text.lastIndexOf(' ', max);
  return `${text.slice(0, cut > 0 ? cut : max)}…`;
}
