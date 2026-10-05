'use client';

import { useEffect, useState } from 'react';
import site from '@config/site';
import { getStoredTheme, setStoredTheme } from '@/lib/storage';
import Icon from '@/components/ui/Icon';

/**
 * Flips `data-theme` on <html>, which swaps every CSS variable at once.
 * The initial value is applied by the inline script in the root layout, so
 * this component only has to stay in sync after hydration.
 */
export default function ThemeToggle() {
  const [mode, setMode] = useState(site.theme.defaultMode);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMode(document.documentElement.getAttribute('data-theme') ?? site.theme.defaultMode);
    setMounted(true);
  }, []);

  if (!site.theme.allowToggle) return null;

  function toggle() {
    const next = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    setStoredTheme(next);
    setMode(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid size-9 place-items-center rounded-full text-muted transition-colors
        hover:bg-card hover:text-text"
    >
      {/* Render a stable icon until mounted so SSR and client markup agree. */}
      <Icon name={mounted && mode === 'light' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}
