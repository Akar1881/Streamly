/**
 * ============================================================================
 *  BUILT-IN KEYS — for the build that has no environment
 * ============================================================================
 *
 *  The website reads its keys from the environment, because a deployment has
 *  one. The desktop app does not: it is a folder somebody unzipped, and
 *  `next build` does not copy `.env.local` into the standalone bundle, so the
 *  server that starts inside it has no `TMDB_API_KEY` and never will.
 *
 *  That matters more than it sounds. The first-run screen offers the viewer a
 *  choice — their own keys, or ours — and "ours" has to exist on the other
 *  side of it. Without this step the wizard would make a promise the app could
 *  not keep, and the failure would look like a broken app rather than a missing
 *  build step: every page empty, no explanation, on a machine nobody can debug.
 *
 *  So the values are read here and written to a JSON file that ships beside the
 *  shell. `src/lib/settings.js` reads it at runtime as the last tier of the
 *  lookup, after a key the viewer set and after the environment.
 *
 *  ---------------------------------------------------------------------------
 *  It is gitignored, and it has to be
 *  ---------------------------------------------------------------------------
 *
 *  `desktop/builtin-keys.json` holds real credentials. It is generated, it is
 *  never committed, and it is deleted and rewritten on every build — a stale
 *  copy that survived a key rotation would be worse than no copy at all, since
 *  it would fail silently rather than loudly.
 *
 *  Anyone who has the AppImage can read the file out of it. That was accepted
 *  when this was planned — see the trade-off noted in the desktop README — and
 *  it is the same exposure a browser extension with a bundled API key has. The
 *  one key it is worth thinking about is the translator's, which is billed per
 *  use; it is also the one key that cannot be left out, because the subtitle
 *  pipeline does not work without it.
 * ============================================================================
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Everything the app needs to be complete out of the box.
 *
 * All four, not just the three the viewer may replace. The translator's key is
 * deliberately not editable — see `EDITABLE` in `src/lib/settings.js` — which
 * makes it the one key with no second source if it is missing here.
 */
const NAMES = ['TMDB_API_KEY', 'TMDB_ACCESS_TOKEN', 'WYZIE_API_KEY', 'TRANSLATE_API_KEY'];

/**
 * The files `next build` would have read, most specific first.
 *
 * Same order Next uses, and the same order this file's output is consulted in:
 * `.env.local` is where a developer's real keys live and is gitignored;
 * `.env` is the committed default and usually holds nothing but placeholders.
 */
const FILES = ['.env.local', '.env'];

/**
 * One file's contents as a flat object.
 *
 * A deliberately small dotenv reader rather than a dependency: this needs
 * `NAME=value`, comments and quotes, and nothing else — no interpolation, no
 * `export`, no multi-line values. Anything more elaborate would be a parser to
 * maintain for a file this script reads once per release.
 */
async function parseEnvFile(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return {};
  }

  const found = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const at = trimmed.indexOf('=');
    if (at === -1) continue;

    const name = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();

    // Stripped only when both ends carry the same quote, so a value that
    // genuinely ends in one is not quietly truncated.
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    if (value) found[name] = value;
  }

  return found;
}

async function main() {
  const sources = [process.env];

  for (const name of FILES) {
    sources.push(await parseEnvFile(path.join(root, name)));
  }

  const keys = {};
  const missing = [];

  for (const name of NAMES) {
    // First source that has it wins, so a shell variable beats `.env.local`,
    // which beats `.env` — most specific to least.
    const source = sources.find((candidate) => candidate?.[name]?.trim?.());
    if (source) keys[name] = String(source[name]).trim();
    else missing.push(name);
  }

  const target = path.join(root, 'desktop', 'builtin-keys.json');
  await writeFile(target, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });

  console.log(`built-in keys: wrote ${Object.keys(keys).length} of ${NAMES.length} to ${path.relative(root, target)}`);

  if (missing.length) {
    /*
     * A warning rather than a failure. A build with no translator key is still
     * a build — the app runs, the catalogue works, and subtitles report the
     * one thing that is true about them. Failing the build would be a worse
     * answer to "I am trying to see whether this compiles".
     */
    console.warn(
      `\n  warning: no value found for ${missing.join(', ')}\n` +
        '  The app will build, but a viewer who skips the first-run screen will ' +
        'not have these, and nothing on screen will say why.\n' +
        '  Put them in .env.local (see .env.example) and build again.\n',
    );
  }
}

await main();
