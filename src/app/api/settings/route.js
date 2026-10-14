/**
 * ============================================================================
 *  SETTINGS — the keys the viewer brought
 * ============================================================================
 *
 *    GET  /api/settings   → where each editable key comes from, and whether it
 *                           can be changed here at all.
 *    PUT  /api/settings   { keys: { NAME: value }, onboarded? }
 *                         → stores them and returns the same shape as GET.
 *
 *  No response from this route has ever contained a key. `status()` in
 *  `src/lib/settings.js` answers with `user`, `builtin` or `none` and nothing
 *  else, and the words are the ones the interface shows. The reason is in that
 *  file's header: a viewer may know that we have a key, never read it.
 *
 *  `PUT` writes to a file on the machine the server is running on, so it is
 *  refused wherever that file would not be the reader's — see `writable()`. On
 *  a deployment the keys are the site's, and answering 403 is the honest
 *  description of that rather than an error.
 *
 *  The page itself does not need `GET`: `/settings` is a server component and
 *  reads the same functions directly. This exists for the wizard, which saves
 *  through it, and so that the whole arrangement can be checked from outside
 *  the interface — including the part where a value must not come back.
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import site from '@config/site';
import { describe, isEditable, markOnboarded, saveKeys, writable } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
}

/**
 * What the client is told about the keys.
 *
 * The fields and their words come from `describe()`, which `/settings` renders
 * from as well, so the wizard and the page cannot disagree about what a field
 * is called or what its state is called. What is added here is the two facts
 * that are about the *deployment* rather than about the keys.
 */
function snapshot() {
  return {
    /** True inside the desktop app, where the wizard is what opens first. */
    desktop: process.env.STREAMLY_DESKTOP === '1',
    writable: writable(),
    ...describe(),
  };
}

export async function GET() {
  return NextResponse.json(snapshot(), { headers: NO_STORE });
}

/**
 * Stores whatever the settings form sent.
 *
 * Names are checked against `EDITABLE` before anything is written, and an
 * unknown one is refused rather than dropped. `saveKeys` would ignore it either
 * way — that is the gate, and it is there so no future caller can bypass it —
 * but a request naming a key we do not accept is somebody expecting it to work,
 * and a 400 says so on the first attempt instead of the third.
 *
 * Values must be strings. A blank one is meaningful: it removes the stored key,
 * which is how the form offers a way back to the built-in one.
 */
export async function PUT(request) {
  if (!writable()) {
    return NextResponse.json(
      { error: site.settings.locked },
      { status: 403, headers: NO_STORE },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Expected a JSON body.');
  }

  const keys = body?.keys ?? {};
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
    return badRequest('"keys" must be an object of key names to values.');
  }

  for (const [name, value] of Object.entries(keys)) {
    if (!isEditable(name)) {
      return badRequest(`"${name}" is not a key this app lets you change.`);
    }
    if (typeof value !== 'string') {
      return badRequest(`"${name}" must be a string.`);
    }
  }

  saveKeys(keys);

  // Sent by the wizard's last step, and only ever set — clearing it is not a
  // thing the interface asks for, because the app only ever wants to know
  // whether it has been through this before.
  if (body?.onboarded === true) markOnboarded();

  return NextResponse.json(snapshot(), { headers: NO_STORE });
}
