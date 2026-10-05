'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getMyList,
  isSaved,
  toggleMyList,
  onStorageChange,
} from '@/lib/storage';

/**
 * Provides the My List state to any component that needs it.
 * Stays in sync across multiple tabs and across the same page via the
 * `streamly:storage` custom event.
 */
export default function useMyList() {
  const [list, setList] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setList(getMyList());
    setHydrated(true);
    return onStorageChange(() => setList(getMyList()));
  }, []);

  const toggle = useCallback(
    (media) => {
      const nowSaved = toggleMyList(media);
      setList(getMyList());
      return nowSaved;
    },
    [],
  );

  const saved = useCallback(
    (mediaType, id) => (hydrated ? isSaved(mediaType, id) : false),
    [hydrated, list], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { list, saved, toggle, hydrated };
}
