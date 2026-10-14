/**
 * ============================================================================
 *  SETTINGS — the keys the viewer brought
 * ============================================================================
 *
 *  Some of what this app needs to work is an account: TMDB to find a title,
 *  Wyzie to find a subtitle. The site has always carried its own accounts in
 *  the environment, which is right for a deployment and wrong for an app
 *  somebody installs — there, the keys belong to whoever is sitting in front
 *  of it, and they should not have to edit a dotfile to use their own.
 *
 *  So the environment stops being the only place a key can live. This module
 *  keeps a small JSON file beside the app's other data and answers the same
 *  question every accessor used to ask the environment:
 *
 *      the viewer's key, or ours, or nothing.
 *
 *  Ours can itself come from two places, and on the desktop app it has to. A
 *  deployment is handed its keys in the environment; the packaged app is not —
 *  `next build` does not copy `.env.local` into the standalone bundle, so the
 *  server that starts inside the window has an empty environment and would have
 *  no TMDB account at all. `scripts/desktop-keys.mjs` writes what it found into
 *  a file that ships beside the shell, and `STREAMLY_BUILTIN_KEYS` points at it.
 *  That is the third tier, and without it the wizard's "or use the built-in
 *  keys" would be an offer the app could not honour.
 *
 *  The order is the viewer, then the environment, then the build — most
 *  specific first, and the environment ahead of the build because a developer
 *  running the desktop bundle from a shell that already exports a key has just
 *  asked for that one in the most deliberate way available to them.
 *
 *  ---------------------------------------------------------------------------
 *  What this module will and will not do
 *  ---------------------------------------------------------------------------
 *
 *  Three names are replaceable — `EDITABLE` below. Everything else is ours:
 *  the translation key in particular is deliberately not on that list, so it
 *  cannot be set from the interface *or* from a hand-written request to the
 *  API. `saveKeys` reads that list rather than its argument, which makes the
 *  restriction structural: there is no path through this file that writes a
 *  name it does not recognise.
 *
 *  Reading is synchronous, and that is not an oversight. The two callers —
 *  `credentials()` in `src/lib/tmdb/client.js` and `wyzieKey()` in
 *  `src/lib/subtitles/wyzie.js` — are synchronous today and are called from
 *  everywhere; making them await would ripple out through every page for the
 *  sake of one `readFile` of a file that is almost always already in memory.
 *  The cache below is keyed on the file's mtime, so the read is one `stat` in
 *  the ordinary case and the file can still be edited by hand while the app is
 *  running and be picked up.
 *
 *  ---------------------------------------------------------------------------
 *  The values never go back out
 *  ---------------------------------------------------------------------------
 *
 *  `status()` is what the interface is told, and it reports where each key
 *  comes from — `user`, `builtin` or `none` — and never what it is. A viewer
 *  can see that we have a Wyzie key; they cannot read it, and neither can
 *  anything that reads the network tab. That is the whole reason this returns
 *  a word instead of a value, and the reason there is no `getAll()`.
 *
 *  Server-only. It reads the process environment and the filesystem, so it must
 *  never be imported from a file marked `'use client'`.
 * ============================================================================
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import site from '@config/site';

/**
 * The keys a viewer may replace with their own.
 *
 * This list is the permission, not a menu — the interface renders exactly this,
 * in this order, and `saveKeys` writes exactly this and nothing else. Adding a
 * name here is what makes it editable; `settings.fields` in `config/site.js`
 * supplies the words, and is allowed to lag behind without that hiding a key.
 *
 * `TRANSLATE_API_KEY` is absent on purpose. It is billed per use, the site
 * covers it, and there is no version of "paste your own" for it that is worth
 * the risk of a viewer's key being spent by something they cannot see.
 */
export const EDITABLE = ['TMDB_API_KEY', 'TMDB_ACCESS_TOKEN', 'WYZIE_API_KEY'];

/** True when `name` is one of the keys a viewer is allowed to set. */
export function isEditable(name) {
  return EDITABLE.includes(name);
}

/**
 * Where the app keeps its data.
 *
 * `STREAMLY_DATA_DIR` is set by the desktop shell to the per-user application
 * directory Electron chooses. Without it — `next dev`, or a deployed site that
 * happens to ask — the XDG convention is used instead, so development and the
 * packaged app exercise the same path with different roots.
 *
 * Deliberately *not* resolved against `process.cwd()`. The subtitle cache does
 * that because its path is a deployment setting relative to the project; this
 * one is not, and a build directory is the wrong place for a viewer's keys.
 */
export function dataDir() {
  const configured = process.env.STREAMLY_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);

  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), '.config');
  return path.join(base, 'streamly');
}

/** The settings file, for a caller that wants to name it in a message. */
export function filePath() {
  return path.join(dataDir(), 'settings.json');
}

/**
 * The last read, and the mtime it was read at.
 *
 * A `stat` per call rather than a `readFile` per call: `getKey` runs on the way
 * into every TMDB request, and this file changes when someone opens Settings
 * and almost never otherwise.
 */
let cache = null;

/**
 * The stored settings, as an object.
 *
 * Never throws. A missing file is the ordinary first-run state, and an
 * unreadable or malformed one is somebody's text editor — in both cases the
 * answer is "no settings", which falls the app back onto the environment and
 * leaves it working. Failing loudly here would take the whole site down over a
 * stray comma in a file nothing else reads.
 */
export function read() {
  const file = filePath();

  let mtimeMs;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    // No file: no settings, and nothing to cache.
    cache = null;
    return {};
  }

  if (cache?.mtimeMs === mtimeMs) return cache.value;

  let value;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    value = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (cause) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[settings] ${file} could not be read, so no keys were loaded from it:`, cause);
    }
    value = {};
  }

  // Cached even when the parse failed, so a broken file is complained about
  // once per edit rather than once per request.
  cache = { mtimeMs, value };
  return value;
}

/**
 * Replaces the file's contents.
 *
 * Written to a temporary name and renamed over the target, so a reader either
 * finds the old settings or the new ones and never half of each — the same
 * reason, and the same shape, as `write` in `src/lib/subtitles/disk.js`.
 *
 * `0o600` because this file holds API keys: it is the owner's to read and
 * nobody else's, which is what it would be if they had put the keys in a
 * `.env.local` themselves. The mode applies when the temporary file is created,
 * which is every write, since the name carries this process's pid.
 */
function write(value) {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });

  const file = path.join(dir, 'settings.json');
  const temp = `${file}.${process.pid}.tmp`;

  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);

  // Whatever was cached belongs to the file that no longer exists.
  cache = null;
}

/**
 * The keys that shipped in the build, when there were any.
 *
 * The desktop app has no environment to read from — `next build` does not copy
 * `.env.local` into the standalone bundle — so the shell points `STREAMLY_BUILTIN_KEYS`
 * at a JSON file generated by `scripts/desktop-keys.mjs` and shipped beside it.
 * Read once, because it is part of the build and cannot change while the app is
 * running; a release with different keys is a different app.
 *
 * Absent on a deployment, where the environment is the source and this returns
 * nothing. Absent too in a desktop build made without `.env.local`, which is
 * exactly the case where the app should fall back and say so rather than
 * pretend — `status()` reports `none` and the interface stops claiming a
 * built-in key exists.
 */
let builtins = null;

function builtinKeys() {
  if (builtins) return builtins;

  const file = process.env.STREAMLY_BUILTIN_KEYS?.trim();
  if (!file) return (builtins = {});

  try {
    const parsed = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
    builtins = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (cause) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[settings] could not read the built-in keys at ${file}:`, cause);
    }
    builtins = {};
  }

  return builtins;
}

/**
 * The key to use, or null when there is none.
 *
 * Three tiers, most specific first: what the viewer set, then the environment,
 * then whatever the build shipped with. The order matters in the only case
 * where more than one is present — a developer running the desktop build from a
 * shell that already has `TMDB_API_KEY` exported — and there the shell should
 * win, because it is the most recent thing they deliberately did.
 *
 * An empty or whitespace-only entry counts as not set at every tier, so
 * clearing a field in the interface is the same act as never filling it in.
 */
export function getKey(name) {
  const own = isEditable(name) ? read()[name] : null;
  if (typeof own === 'string' && own.trim()) return own.trim();

  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;

  const fromBuild = builtinKeys()[name];
  return typeof fromBuild === 'string' && fromBuild.trim() ? fromBuild.trim() : null;
}

/**
 * Where each editable key comes from, for the interface.
 *
 * `user` and `builtin` are the distinction the settings page exists to draw:
 * the first means the viewer's own key is in play, the second that ours is —
 * whichever of the two places ours came from. Neither carries a value; see the
 * note at the top of this file.
 */
export function status() {
  const own = read();

  return EDITABLE.map((name) => {
    const mine = own[name];
    if (typeof mine === 'string' && mine.trim()) return { name, source: 'user' };

    const ours = process.env[name]?.trim() || builtinKeys()[name];
    return { name, source: ours ? 'builtin' : 'none' };
  });
}

/**
 * Whether a key can be changed here at all.
 *
 * True in the desktop app, which owns its data directory, and in development,
 * where writing to a real config directory is exactly what you want to test.
 * False for a deployment: the keys there are the site's rather than the
 * reader's, there is no per-viewer file to write, and the filesystem the
 * function runs on is not one that keeps anything.
 */
export function writable() {
  return process.env.STREAMLY_DESKTOP === '1' || process.env.NODE_ENV !== 'production';
}

/**
 * Stores the keys from a settings form.
 *
 * Iterates `EDITABLE` rather than the argument, so a name that is not one of
 * ours is not written even if it arrives — this is the gate described at the
 * top of the file, and it is here rather than in the API route so that every
 * future caller inherits it.
 *
 * A blank value removes the stored key, which is how the interface offers a
 * way back to the built-in one: the entry disappears and `getKey` falls
 * through to the environment again.
 *
 * @param {Record<string, unknown>} values  keyed by environment variable name
 * @returns {Array<{name: string, source: string}>}  as `status()`
 */
export function saveKeys(values) {
  const next = read();
  let changed = false;

  for (const name of EDITABLE) {
    if (!(name in values)) continue;

    const value = typeof values[name] === 'string' ? values[name].trim() : '';
    if (value) next[name] = value;
    else delete next[name];

    changed = true;
  }

  if (changed) write(next);
  return status();
}

/** True once the first-run wizard has been completed or skipped. */
export function onboarded() {
  return read().onboarded === true;
}

/**
 * Records that the wizard has been dealt with.
 *
 * Set for a skip as much as for a save, because it is not a record of having
 * added keys — it is a record of having been asked, so that the app opens on
 * the catalogue next time either way.
 *
 * Written even when the file already exists and nothing else changed, because
 * the call is the point: this is the one setting whose meaning is "the viewer
 * has seen the screen", and a no-op write of the same contents costs nothing.
 */
export function markOnboarded() {
  const next = read();
  next.onboarded = true;
  write(next);
}

/**
 * The keys as the server wants them shown.
 *
 * Built here rather than in each of the two callers because there are two —
 * `/settings` renders a server component and `/api/settings` answers the
 * wizard's save — and they have to agree about a field's label, its help text
 * and which word to use for its state. Assembling it twice is how those drift.
 *
 * Contains no values. `status()` is the only thing in this file that sees one
 * and it says `user`, `builtin` or `none` — see `src/lib/settings.js`'s header.
 */
export function describe() {
  const copy = site.settings.fields ?? {};

  return {
    fields: status().map(({ name, source }) => ({
      name,
      source,
      label: copy[name]?.label ?? name,
      help: copy[name]?.help ?? null,
      href: copy[name]?.href ?? null,
      linkLabel: copy[name]?.linkLabel ?? null,
    })),

    /**
     * Every word the interface puts beside a field, flat, so a caller can index
     * it by a field's `source` directly. `locked` is in here for the same
     * reason even though it belongs to no single field.
     */
    words: { ...site.settings.state, locked: site.settings.locked },
  };
}
