'use client';

import { useCallback, useEffect, useState, useRef } from 'react';

/**
 * Returns `true` when the viewport matches the given media query.
 * Safely returns `false` on the server and before hydration.
 */
export default function useMediaQuery(query) {
  const mql = useRef(null);
  const [matches, setMatches] = useState(false);

  const sync = useCallback((event) => setMatches(event.matches), []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    mql.current = window.matchMedia(query);
    setMatches(mql.current.matches);
    mql.current.addEventListener('change', sync);
    return () => mql.current.removeEventListener('change', sync);
  }, [query, sync]);

  return matches;
}
