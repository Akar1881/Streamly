/**
 * ============================================================================
 *  DESKTOP STAGING — the two directories `standalone` leaves behind
 * ============================================================================
 *
 *  `output: 'standalone'` traces the server's JavaScript and its dependencies
 *  and emits a `.next/standalone/server.js` that runs on its own. What it does
 *  not put beside it is anything it cannot trace, and two directories are not
 *  JavaScript:
 *
 *    .next/static   the hashed CSS and client bundles the built HTML links to
 *    public         the logo, the favicon, the Google verification file
 *
 *  Next's own documentation lists copying these as a required step of using
 *  standalone output. Skip it and the app starts, serves HTML, and arrives in
 *  the window completely unstyled with no client JavaScript — every page looks
 *  broken in a way that suggests the app is broken rather than that two copies
 *  are missing.
 *
 *  Run by `npm run desktop:build`, immediately after the build that produced
 *  the directory it copies into.
 * ============================================================================
 */

import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const standalone = path.join(root, '.next', 'standalone');

/** Source on the left, where it belongs inside the bundle on the right. */
const COPIES = [
  [path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static')],
  [path.join(root, 'public'), path.join(standalone, 'public')],
];

/**
 * The one failure worth naming.
 *
 * A missing `.next/standalone` means the build that was supposed to produce it
 * did not — nearly always because `STREAMLY_DESKTOP=1` was not set, and
 * `next.config.mjs` therefore left `output` off and built an ordinary
 * deployment bundle instead. Left to itself `cp` would report the first of the
 * copies and not the reason.
 */
async function assertBuilt() {
  try {
    await stat(standalone);
    return true;
  } catch {
    console.error(
      'No .next/standalone to stage into.\n\n' +
        'This runs after a standalone build; use `npm run desktop:build`, which ' +
        'sets STREAMLY_DESKTOP=1 for the build and calls this afterwards.',
    );
    return false;
  }
}

async function main() {
  if (!(await assertBuilt())) process.exit(1);

  for (const [from, to] of COPIES) {
    /*
     * Removed first, because `cp` merges. A file deleted from `public` between
     * two builds would otherwise live on in the bundle for ever, and be served
     * from a path that no longer exists in the repository.
     */
    await rm(to, { recursive: true, force: true });
    await cp(from, to, { recursive: true, force: true });
    console.log(`staged ${path.relative(root, to)}`);
  }
}

await main();
