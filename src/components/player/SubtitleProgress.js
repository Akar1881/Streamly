'use client';

import site from '@config/site';
import Button from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  SUBTITLE WAITING SCREEN
 * ============================================================================
 *
 *  Stands in for the player while the Kurdish subtitle is being made. It is
 *  the same shape and colour as the player box so the page does not jump when
 *  the iframe replaces it.
 *
 *  It says what is actually happening rather than spinning meaninglessly: the
 *  search and the translation are different waits, and the translation has real
 *  progress behind it. Someone watching a bar move will wait far longer than
 *  someone watching a spinner.
 * ============================================================================
 */

export default function SubtitleProgress({ phase, progress, label, nativeName, onSkip }) {
  const translating = phase === 'translating';
  const percent = Math.round(Math.min(Math.max(progress, 0), 1) * 100);

  return (
    <div
      className="grid aspect-video w-full place-items-center rounded-[var(--radius-card)]
        border border-line bg-card px-6 text-center"
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="grid size-14 place-items-center rounded-full border border-line bg-surface text-muted">
          <Icon name="globe" size={24} />
        </div>

        <div>
          <p className="text-base font-medium">Preparing {label} subtitles</p>
          {nativeName && <p className="mt-0.5 text-sm text-muted">{nativeName}</p>}
        </div>

        <p className="text-sm leading-relaxed text-muted" aria-live="polite">
          {translating ? (
            <>
              Translating the {label} lines — {percent}%
            </>
          ) : (
            <>Finding a subtitle to translate…</>
          )}
        </p>

        {translating && (
          <div
            className="h-1 w-56 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          </div>
        )}

        <p className="max-w-xs text-xs leading-relaxed text-muted">
          This only happens the first time someone watches this title — the translation is
          saved for everyone after you.
        </p>

        {site.subtitles.allowSkip && onSkip && (
          <Button variant="ghost" size="sm" onClick={onSkip} className="mt-1">
            Watch without subtitles
          </Button>
        )}
      </div>
    </div>
  );
}
