'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  SETUP WIZARD — the first-run screen
 * ============================================================================
 *
 *  Three steps, two of them a single click: welcome, keys, done. The desktop
 *  shell opens this instead of the catalogue when nothing has been set up yet,
 *  and never again — see `onboarded()` in `src/lib/settings.js`, which the skip
 *  sets just as much as the save does.
 *
 *  ---------------------------------------------------------------------------
 *  Skippable is the design, not a concession
 *  ---------------------------------------------------------------------------
 *
 *  Everything here is optional and the screen says so before it says anything
 *  else, because it is true: Streamly works on the day it is installed, on keys
 *  that are already in the build. The viewer is being offered a better version
 *  of a working thing, not asked to complete a setup, and a wizard that is
 *  framed as a requirement would be lying about that on its first screen.
 *
 *  So the skip is a real button rather than a link in small print, and it
 *  reaches the same place the save does.
 *
 *  ---------------------------------------------------------------------------
 *  What the two endings have in common
 *  ---------------------------------------------------------------------------
 *
 *  Both write `onboarded` — see `finish`. The flag is a record of having been
 *  asked, so that the app opens on the catalogue next time either way; without
 *  it, a viewer who chose the built-in keys would be shown this screen on every
 *  launch and would reasonably read that as it not having worked.
 * ============================================================================
 */

export default function SetupWizard({ fields, words, writable, copy }) {
  const [step, setStep] = useState('welcome');
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /** Whether the last save stored anything, which decides what step three says. */
  const [usingOwn, setUsingOwn] = useState(false);

  const typed = Object.values(draft).some((value) => value.trim());

  function edit(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
    setError(null);
  }

  /** Stores what was typed and records the screen as dealt with. */
  async function finish(keys) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys, onboarded: true }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `Could not save (${response.status}).`);

      setUsingOwn(Object.keys(keys).length > 0);
      setStep('done');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  function saveAndContinue() {
    const keys = {};
    for (const [name, value] of Object.entries(draft)) {
      if (value.trim()) keys[name] = value.trim();
    }
    return finish(keys);
  }

  const card = 'rounded-[var(--radius-card)] border border-line bg-card p-6 sm:p-8';

  /**
   * On a server there is nowhere to write a key and the keys are the site's
   * rather than the reader's, so the wizard has nothing to offer and says so
   * instead of presenting a form that would fail on submit.
   */
  if (!writable) {
    return (
      <div className={`${card} text-center`}>
        <span className="mx-auto grid size-12 place-items-center rounded-full border border-line bg-surface text-muted">
          <Icon name="info" size={22} />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{words.locked}</p>
        <Button variant="primary" size="lg" className="mt-6 w-full sm:w-auto" href="/">
          {copy.done.action}
        </Button>
      </div>
    );
  }

  if (step === 'welcome') {
    return (
      <div className={`${card} text-center`}>
        <span className="mx-auto grid size-12 place-items-center rounded-full border border-line bg-surface">
          <Icon name="film" size={22} />
        </span>

        <h1 className="mt-4 text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{copy.intro}</p>

        <Button
          variant="primary"
          size="lg"
          className="mt-6 w-full sm:w-auto"
          onClick={() => setStep('keys')}
        >
          Let&rsquo;s get started
        </Button>
      </div>
    );
  }

  if (step === 'keys') {
    return (
      <div className={card}>
        <h1 className="text-xl font-bold tracking-tight">{copy.keys.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{copy.keys.message}</p>

        <div className="mt-6 space-y-5">
          {fields.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              badge={words[field.source] ?? field.source}
              tone={field.source}
              help={field.help}
              href={field.href}
              linkLabel={field.linkLabel}
              secret
              disabled={busy}
              placeholder="Paste your key"
              value={draft[field.name] ?? ''}
              onChange={(event) => edit(field.name, event.target.value)}
            />
          ))}
        </div>

        {error && (
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted">
            <Icon name="alert-circle" size={14} />
            {error}
          </p>
        )}

        {/*
          Save first in the DOM and second on screen — `flex-row-reverse` puts
          the primary action on the right of a wide layout and *last* on the
          stacked one a phone gets, which is where the thumb expects it.
        */}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row-reverse sm:items-center sm:justify-start">
          <Button
            variant="primary"
            onClick={saveAndContinue}
            disabled={!typed || busy}
            className="w-full sm:w-auto"
          >
            {busy ? 'Saving…' : copy.keys.save}
          </Button>

          <Button
            variant="ghost"
            onClick={() => finish({})}
            disabled={busy}
            className="w-full sm:w-auto"
          >
            {copy.keys.skip}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${card} text-center`}>
      <span className="mx-auto grid size-12 place-items-center rounded-full border border-line bg-surface">
        <Icon name="check" size={22} />
      </span>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">{copy.done.title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        {usingOwn ? copy.done.usingOwn : copy.done.usingBuiltin}
      </p>

      <Button variant="primary" size="lg" className="mt-6 w-full sm:w-auto" href="/">
        {copy.done.action}
      </Button>
    </div>
  );
}
