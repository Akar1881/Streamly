'use client';

import { useId, useState } from 'react';
import Icon from './Icon';

/**
 * ============================================================================
 *  FIELD — a labelled text input
 * ============================================================================
 *
 *  `ui/` had buttons, chips and dropdowns and nothing to type into, so this is
 *  the first. The settings form and the wizard both need the same four things
 *  in the same order, and both get them from here:
 *
 *    1. what the field is
 *    2. where its value currently comes from — the `badge`
 *    3. the input
 *    4. a line saying where to get one, with a link when there is one
 *
 *  ---------------------------------------------------------------------------
 *  Why the badge is third-party and not the input's business
 *  ---------------------------------------------------------------------------
 *
 *  The badge is passed in rather than derived, because "using the built-in key"
 *  is a fact about the server's configuration and not about the box on screen —
 *  an empty box with a filled-in built-in key behind it is the normal, working
 *  state, and it would look identical to a broken one without it.
 *
 *  ---------------------------------------------------------------------------
 *  `secret`, and why the value can be revealed
 *  ---------------------------------------------------------------------------
 *
 *  Masked, because a key on screen is a key in a screen recording. But it is
 *  the viewer's *own* key that is ever in here — ours is never sent to the
 *  client at all — and the common way to get this wrong is a paste that
 *  silently dropped its last character, which a mask hides perfectly. So the
 *  eye is there, and it is the only way to check your own work.
 * ============================================================================
 */

/** How a value's current source is drawn. Keyed by `source` from the server. */
const TONES = {
  user: 'border-transparent bg-accent text-accent-text',
  builtin: 'border-line bg-surface text-muted',
  none: 'border-line bg-surface text-star',
};

export default function Field({
  label,
  badge,
  tone = 'builtin',
  help,
  href,
  linkLabel,
  secret = false,
  disabled = false,
  className = '',
  ...rest
}) {
  const id = useId();
  const [shown, setShown] = useState(false);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>

        {badge && (
          <span
            className={`shrink-0 rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px]
              font-medium ${TONES[tone] ?? TONES.builtin}`}
          >
            {badge}
          </span>
        )}
      </div>

      <div className="relative mt-2">
        <input
          id={id}
          disabled={disabled}
          type={secret && !shown ? 'password' : 'text'}
          // A key is not a sentence and not a username, and a browser offering
          // to fill one in from a saved password would be filling this box with
          // something that is not a key.
          autoComplete={secret ? 'off' : undefined}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className={`h-11 w-full rounded-[var(--radius-button)] border border-line bg-card
            px-3.5 text-sm text-text transition-colors placeholder:text-muted
            focus:border-accent focus:outline-none disabled:cursor-not-allowed
            disabled:opacity-60 ${secret ? 'pr-11' : ''}`}
          {...rest}
        />

        {secret && (
          <button
            type="button"
            onClick={() => setShown((value) => !value)}
            disabled={disabled}
            /*
              Outside the tab order: it is a convenience for the mouse, and a
              viewer filling this form with the keyboard would otherwise have to
              pass it between every key and the next field.
            */
            tabIndex={-1}
            aria-label={shown ? 'Hide the value' : 'Show the value'}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted
              transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name={shown ? 'eye-off' : 'eye'} size={16} />
          </button>
        )}
      </div>

      {(help || href) && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          {help}
          {href && (
            <>
              {help ? ' ' : ''}
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2 transition-colors hover:text-text"
              >
                {linkLabel ?? href}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
