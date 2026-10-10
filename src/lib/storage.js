/**
 * ============================================================================
 *  BROWSER STORAGE
 * ============================================================================
 *  This site has no accounts. The saved list and watch progress live in the
 *  visitor's own browser and never leave it.
 *
 *  Every function is safe to call during server rendering — they all no-op
 *  when `window` is undefined.
 * ============================================================================
 */

const KEYS = {
  myList: 'streamly:my-list',
  progress: 'streamly:progress',
  theme: 'streamly:theme',
  playerSettings: 'streamly:player',
  subtitleChoice: 'streamly:subtitles',
};

/** Lets components re-render when another tab (or component) changes storage. */
const CHANGE_EVENT = 'streamly:storage';

function canUseStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false; // Safari private mode and similar
  }
}

function read(key, fallback) {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
  } catch {
    // Quota exceeded — not worth breaking the page over.
  }
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function onStorageChange(handler) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', handler); // other tabs
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

/* -------------------------------------------------------------------------- */
/*  MY LIST                                                                   */
/* -------------------------------------------------------------------------- */

/** Everything the visitor has saved, most recently added first. */
export function getMyList() {
  const list = read(KEYS.myList, []);
  return Array.isArray(list) ? list : [];
}

function entryKey(mediaType, id) {
  return `${mediaType}:${id}`;
}

export function isSaved(mediaType, id) {
  return getMyList().some((item) => entryKey(item.mediaType, item.id) === entryKey(mediaType, id));
}

/**
 * Saves the few fields a card needs, so My List renders instantly without
 * re-fetching every title from TMDB.
 */
export function addToMyList(media) {
  const list = getMyList();
  const key = entryKey(media.mediaType, media.id);
  if (list.some((item) => entryKey(item.mediaType, item.id) === key)) return list;

  const next = [
    {
      id: media.id,
      mediaType: media.mediaType,
      title: media.title,
      posterPath: media.posterPath ?? null,
      releaseDate: media.releaseDate ?? null,
      voteAverage: media.voteAverage ?? 0,
      addedAt: Date.now(),
    },
    ...list,
  ];

  write(KEYS.myList, next);
  return next;
}

export function removeFromMyList(mediaType, id) {
  const key = entryKey(mediaType, id);
  const next = getMyList().filter((item) => entryKey(item.mediaType, item.id) !== key);
  write(KEYS.myList, next);
  return next;
}

/** Returns the new saved state, for an optimistic button toggle. */
export function toggleMyList(media) {
  if (isSaved(media.mediaType, media.id)) {
    removeFromMyList(media.mediaType, media.id);
    return false;
  }
  addToMyList(media);
  return true;
}

export function clearMyList() {
  write(KEYS.myList, []);
}

/* -------------------------------------------------------------------------- */
/*  CONTINUE WATCHING                                                         */
/* -------------------------------------------------------------------------- */

const MAX_PROGRESS_ENTRIES = 20;

/** Most recently watched first. */
export function getProgress() {
  const entries = read(KEYS.progress, []);
  return Array.isArray(entries) ? entries : [];
}

/** The history entry for one title, or `undefined` if it has never been opened. */
export function getProgressEntry(mediaType, id) {
  return getProgress().find(
    (item) => entryKey(item.mediaType, item.id) === entryKey(mediaType, id),
  );
}

/**
 * Records that the visitor opened a title, and where they are in it.
 *
 * It has two callers, and the difference between them is why this is not a
 * plain overwrite. The watch page calls it once as it opens, to put the title
 * in the history; the player calls it every few seconds with a position. The
 * first of those has no position to give, so a call without `seconds` *keeps*
 * what is already stored — otherwise merely opening a title would reset it to
 * the start, and a resume could never survive being resumed.
 *
 * A position also only means anything inside a single episode, so a call whose
 * season/episode differs from what is stored starts from zero. Without that,
 * opening S2E1 would pick up at whatever minute S1E5 was abandoned at.
 */
export function recordProgress(media) {
  const key = entryKey(media.mediaType, media.id);
  const entries = getProgress();
  const rest = entries.filter((item) => entryKey(item.mediaType, item.id) !== key);

  const season = media.season ?? null;
  const episode = media.episode ?? null;

  const previous = entries.find((item) => entryKey(item.mediaType, item.id) === key);
  const sameEpisode =
    previous && (previous.season ?? null) === season && (previous.episode ?? null) === episode;

  // Where the last of these came from, when there is one.
  const carried = (field) => (sameEpisode ? (previous[field] ?? 0) : 0);

  const next = [
    {
      id: media.id,
      mediaType: media.mediaType,
      title: media.title,
      posterPath: media.posterPath ?? null,
      backdropPath: media.backdropPath ?? null,
      season,
      episode,
      seconds: media.seconds ?? carried('seconds'),
      duration: media.duration ?? carried('duration'),
      watchedAt: Date.now(),
    },
    ...rest,
  ].slice(0, MAX_PROGRESS_ENTRIES);

  write(KEYS.progress, next);
  return next;
}

export function removeProgress(mediaType, id) {
  const key = entryKey(mediaType, id);
  const next = getProgress().filter((item) => entryKey(item.mediaType, item.id) !== key);
  write(KEYS.progress, next);
  return next;
}

export function clearProgress() {
  write(KEYS.progress, []);
}

/* -------------------------------------------------------------------------- */
/*  THEME                                                                     */
/* -------------------------------------------------------------------------- */

export function getStoredTheme() {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(KEYS.theme);
  } catch {
    return null;
  }
}

export function setStoredTheme(mode) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(KEYS.theme, mode);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/*  SUBTITLE CHOICE                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The subtitle language the viewer last picked, so the player can turn it on
 * again by itself on the next title.
 *
 * Two different things are stored as one value, because from the viewer's side
 * they are one decision: a language, and "off". Turning captions off is not the
 * absence of a choice — it is a choice, made in the captions menu, and the
 * player treats it as one; what it is *not* is the fallback the player reaches
 * for when a preferred language is missing, which is why the two cannot share a
 * representation here.
 *
 * `null` means the viewer has never chosen, which is different from having
 * chosen "off", and is the state a first visit is in.
 *
 * @returns {{label: string|null}|null}
 */
export function getSubtitleChoice() {
  const stored = read(KEYS.subtitleChoice, null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;

  if (stored.off === true) return { label: null };

  return typeof stored.label === 'string' && stored.label.trim()
    ? { label: stored.label }
    : null;
}

/**
 * Records the viewer's subtitle language, or `null`/`''` for captions off.
 *
 * A language is stored by its label rather than by index: the list is rebuilt
 * for every title, from whatever that title's provider and translation offer,
 * and an index into one title's list means nothing in another's.
 */
export function setSubtitleChoice(label) {
  const name = typeof label === 'string' && label.trim() ? label.trim() : null;
  write(KEYS.subtitleChoice, name ? { label: name } : { off: true });
}

/* -------------------------------------------------------------------------- */
/*  PLAYER PREFERENCES                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How the viewer likes their subtitles, as the last object written.
 *
 * Returned raw rather than merged with the defaults in `config/site.js`: this
 * layer does not know what a valid subtitle size is, and a stored object from an
 * older version of the site may be missing keys or hold values that no longer
 * exist. Reconciling that is `src/lib/player/settings.js`, which owns the shape.
 *
 * @returns {object|null}
 */
export function getPlayerSettings() {
  const stored = read(KEYS.playerSettings, null);
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null;
}

export function setPlayerSettings(settings) {
  write(KEYS.playerSettings, settings);
}

export function clearPlayerSettings() {
  write(KEYS.playerSettings, null);
}

export { KEYS as STORAGE_KEYS };
