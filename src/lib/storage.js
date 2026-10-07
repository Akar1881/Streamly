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

/**
 * Records that the visitor opened a title. For shows this also remembers the
 * season and episode so the home page can link straight back to it.
 */
export function recordProgress(media) {
  const key = entryKey(media.mediaType, media.id);
  const rest = getProgress().filter((item) => entryKey(item.mediaType, item.id) !== key);

  const next = [
    {
      id: media.id,
      mediaType: media.mediaType,
      title: media.title,
      posterPath: media.posterPath ?? null,
      backdropPath: media.backdropPath ?? null,
      season: media.season ?? null,
      episode: media.episode ?? null,
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
