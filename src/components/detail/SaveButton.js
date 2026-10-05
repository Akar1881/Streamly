'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import Button from '@/components/ui/Button';
import useMyList from '@/hooks/useMyList';

/**
 * The "save" control on detail pages. Backed by localStorage — there are no
 * accounts, so there is nothing to sign in to.
 */
export default function SaveButton({ media, size = 'md' }) {
  const { saved, toggle, hydrated } = useMyList();
  const [flash, setFlash] = useState(false);

  const isSaved = hydrated && saved(media.mediaType, media.id);

  function onClick() {
    const nowSaved = toggle(media);
    setFlash(nowSaved);
    setTimeout(() => setFlash(false), 1200);
  }

  return (
    <Button
      variant="secondary"
      size={size}
      icon={isSaved ? 'bookmark-check' : 'bookmark'}
      onClick={onClick}
      aria-pressed={isSaved}
      title={isSaved ? 'Remove from My List' : 'Add to My List'}
    >
      <span className="hidden sm:inline">
        {flash ? 'Saved' : isSaved ? 'In My List' : 'My List'}
      </span>
    </Button>
  );
}
