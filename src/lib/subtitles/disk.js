/**
 * ============================================================================
 *  DISK STORAGE — the local-development backend
 * ============================================================================
 *
 *  Translated subtitles on the filesystem: no account, no credentials, nothing
 *  to configure, and the files sit where you can open one and read it while
 *  working on the translation itself.
 *
 *  This is what runs on a laptop, and it is what runs in the desktop app —
 *  `SUBTITLE_CACHE_DIR` points at the app's own data directory there, which is
 *  a real, persistent, per-user location, so none of the objection below
 *  applies to it. What it is *not* is a fit for a serverless host: those give
 *  the app a read-only bundle and a per-instance `/tmp`, so a file written
 *  while serving one request is not there when the next request lands on a
 *  different instance, and the viewer's browser would be handed a URL that
 *  404s. `r2.js` is the backend that fixes that, and it takes over as soon as
 *  it is configured.
 * ============================================================================
 */

import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import site from '@config/site';

/**
 * The directory translated files live in.
 *
 * `SUBTITLE_CACHE_DIR` overrides the configured path for deployments where the
 * project directory is not writable.
 */
export function dir() {
  const configured = process.env.SUBTITLE_CACHE_DIR?.trim() || site.subtitles.cacheDir;

  // `turbopackIgnore` opts this call out of the bundler's static analysis. The
  // directory is read from the environment and differs per deployment, so
  // there is nothing for it to trace — and left alone it decides the whole
  // project (public folder included) might need to ship inside the server
  // bundle.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/**
 * The file behind an already-validated cache name.
 *
 * The name has been through `isSafeName` by the time it arrives, which admits
 * only `[a-z0-9-]` and a `.vtt` suffix — no separators, no `..`, nothing that
 * can climb out of the directory. The check below is the belt to that
 * pattern's braces.
 */
export function pathFor(name) {
  const full = path.resolve(dir(), name);

  if (path.dirname(full) !== dir()) {
    throw new Error(`Refusing to open a subtitle outside the cache: ${name}`);
  }

  return full;
}

export async function read(name) {
  try {
    // `turbopackIgnore` for the same reason as in `dir()`: the path is only
    // known at runtime, so the bundler has nothing to trace and would rather
    // assume the worst and ship the project.
    return await readFile(/* turbopackIgnore: true */ pathFor(name), 'utf8');
  } catch {
    return null;
  }
}

export async function exists(name) {
  try {
    await stat(/* turbopackIgnore: true */ pathFor(name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a finished translation, atomically.
 *
 * The rename is what makes it atomic: a reader either finds the finished file
 * or no file at all, never half a subtitle served as though it were complete.
 * The temp name is per-process so two concurrent jobs cannot collide.
 */
export async function write(name, contents) {
  const file = pathFor(name);

  await mkdir(path.dirname(file), { recursive: true });

  const temp = `${file}.${process.pid}.tmp`;

  try {
    await writeFile(temp, contents, 'utf8');
    await rename(temp, file);
  } catch (error) {
    // Never leave the temp file behind on a failed write.
    await unlink(temp).catch(() => {});
    throw error;
  }
}

/** A filesystem is not a web server, so there is no URL to hand out. */
export function url() {
  return null;
}
