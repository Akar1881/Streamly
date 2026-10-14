'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  SETTINGS FORM — the keys the viewer brought
 * ============================================================================
 *
 *  Three boxes, each showing where its key currently comes from and each
 *  offering to replace it. The server half is `src/lib/settings.js` and the
 *  route it saves through is `/api/settings`.
 *
 *  ---------------------------------------------------------------------------
 *  A stored key is never sent back to this component
 *  ---------------------------------------------------------------------------
 *
 *  Not even the viewer's own. The boxes start empty whatever is stored, and a
 *  filled-in box means "replace it with this" rather than "this is what is
 *  there". Two things follow, and both are the reason for it:
 *
 *  Ours can never appear on screen, accidentally or otherwise, because there is
 *  no path by which a built-in value is ever sent to a browser.
 *
 *  And the page is the same for everybody. If the viewer's own key were
 *  rendered back, every visit to Settings would put it in the HTML of a page
 *  that is otherwise static — cached, logged, screenshotted — to save one paste
 *  in the rare case that somebody wants to change a key they already have.
 *  Replacing is a paste; removing is the button beside it.
 *
 *  ---------------------------------------------------------------------------
 *  Why the page cannot just be re-rendered locally
 *  ---------------------------------------------------------------------------
 *
 *  `status()` is read on the server, from a file this component has no access
 *  to and no business knowing about, so the badge beside each field cannot be
 *  updated from here without guessing at what the write did. `router.refresh()`
 *  asks the server instead, and the badges arrive as new props — which is also
 *  why the draft is cleared by hand rather than by a change in props: it is
 *  local, and nothing the refresh sends will clear it.
 * ============================================================================
 */

export default function SettingsForm({ fields, words, writable }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  /** Only what has been typed into this visit, keyed by name. */
  const [draft, setDraft] = useState({});

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const typed = Object.values(draft).some((value) => value.trim());

  function edit(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
    // A message about the last save is stale the moment the next one is typed,
    // and leaving it up would describe a state that is no longer on screen.
    setStatus('idle');
    setError(null);
  }

  /**
   * Sends one write and re-reads the page.
   *
   * @param {Record<string, string>} keys  a blank value removes the stored key
   */
  async function send(keys) {
    setStatus('saving');
    setError(null);

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `Could not save (${response.status}).`);

      setDraft({});
      setStatus('saved');
      startRefresh(() => router.refresh());
    } catch (cause) {
      setStatus('error');
      setError(cause.message);
    }
  }

  function save() {
    const keys = {};
    for (const [name, value] of Object.entries(draft)) {
      if (value.trim()) keys[name] = value.trim();
    }
    if (Object.keys(keys).length) return send(keys);
  }

  const busy = status === 'saving' || refreshing;

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted">
          <Icon name="settings-2" size={18} />
        </span>
        <h2 className="text-lg font-semibold tracking-tight">Keys</h2>
      </div>

      {!writable && (
        <p className="mt-3 rounded-[var(--radius-button)] border border-line bg-surface p-3 text-xs leading-relaxed text-muted">
          {words.locked}
        </p>
      )}

      <div className="mt-5 space-y-5">
        {fields.map((field) => (
          <div key={field.name}>
            <Field
              label={field.label}
              badge={words[field.source] ?? field.source}
              tone={field.source}
              help={field.help}
              href={field.href}
              linkLabel={field.linkLabel}
              secret
              disabled={!writable || busy}
              placeholder={field.source === 'user' ? 'Paste a replacement' : 'Paste your key'}
              value={draft[field.name] ?? ''}
              onChange={(event) => edit(field.name, event.target.value)}
            />

            {/*
              Only offered when there is something to go back from. A viewer on
              the built-in key has nothing to reset to, and a button that does
              nothing is worse than no button.
            */}
            {writable && field.source === 'user' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => send({ [field.name]: '' })}
                className="mt-2 text-xs text-muted underline underline-offset-2
                  transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                Go back to the built-in key
              </button>
            )}
          </div>
        ))}
      </div>

      {writable && (
        <div className="mt-6 flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={!typed || busy}>
            {busy ? 'Saving…' : 'Save keys'}
          </Button>

          {status === 'saved' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Icon name="check" size={14} />
              Saved
            </span>
          )}

          {status === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Icon name="alert-circle" size={14} />
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
