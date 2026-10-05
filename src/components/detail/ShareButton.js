'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';

/**
 * Shares the current title: the native share sheet where the device has one,
 * falling back to copying the link.
 *
 * The URL is rebuilt from the origin and path so query strings and hashes never
 * leak into a shared link — and so the link matches what the share card was
 * generated for.
 */
export default function ShareButton({ title, size = 'md' }) {
  const [state, setState] = useState('idle'); // 'idle' | 'copied' | 'failed'

  async function onClick() {
    const { origin, pathname } = window.location;
    const url = `${origin}${pathname}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Dismissing the sheet is not a failure — copying anyway would be
        // surprising, so only fall through on a genuine error.
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      // Clipboard access can be blocked outside a secure context.
      setState('failed');
    }

    setTimeout(() => setState('idle'), 1800);
  }

  const label = { idle: 'Share', copied: 'Link copied', failed: 'Copy failed' }[state];

  return (
    <Button
      variant="secondary"
      size={size}
      // The icon alone is all that shows on phones, so it carries the feedback.
      icon={state === 'copied' ? 'check' : 'share'}
      onClick={onClick}
      title="Share"
      aria-live="polite"
    >
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
