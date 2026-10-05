'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getProgress, removeProgress, onStorageChange } from '@/lib/storage';
import { backdropUrl, posterUrl } from '@/lib/images';
import { toSlugId } from '@/lib/format';
import Carousel from '@/components/ui/Carousel';
import Icon from '@/components/ui/Icon';

/**
 * "Continue watching" — reads the local watch history, so it renders nothing
 * on a first visit and never needs an account.
 *
 * Client-only by necessity: the data lives in localStorage.
 */
export default function ContinueWatching() {
  const [items, setItems] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(getProgress());
    setHydrated(true);
    return onStorageChange(() => setItems(getProgress()));
  }, []);

  // Render nothing until hydrated so the server and client markup agree.
  if (!hydrated || items.length === 0) return null;

  return (
    <Carousel title="Continue watching">
      {items.map((item) => {
        const isTv = item.mediaType === 'tv';
        const href = isTv
          ? `/watch/tv/${toSlugId(item.id, item.title)}/${item.season ?? 1}/${item.episode ?? 1}`
          : `/watch/movie/${toSlugId(item.id, item.title)}`;

        const image = backdropUrl(item.backdropPath, 'w780') ?? posterUrl(item.posterPath);

        return (
          <div key={`${item.mediaType}-${item.id}`} className="snap-item w-[240px] shrink-0 sm:w-[280px]">
            <div className="group relative">
              <Link href={href} className="block">
                <div
                  className="relative aspect-video overflow-hidden rounded-[var(--radius-card)]
                    border border-line bg-card transition-colors group-hover:border-muted/40"
                >
                  {image && (
                    <Image
                      src={image}
                      alt=""
                      fill
                      sizes="280px"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />

                  <div className="absolute inset-0 grid place-items-center">
                    <span
                      className="grid size-11 place-items-center rounded-full bg-white/90
                        text-black opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Icon name="play" size={18} className="translate-x-px fill-black" />
                    </span>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <p className="line-clamp-1 text-sm font-medium text-white">{item.title}</p>
                    {isTv && item.season && (
                      <p className="text-xs text-white/70">
                        Season {item.season}, Episode {item.episode}
                      </p>
                    )}
                  </div>
                </div>
              </Link>

              {/* remove from history */}
              <button
                type="button"
                onClick={() => setItems(removeProgress(item.mediaType, item.id))}
                aria-label={`Remove ${item.title} from Continue watching`}
                className="absolute right-2 top-2 grid size-7 place-items-center rounded-full
                  bg-black/70 text-white opacity-0 backdrop-blur-sm transition-opacity
                  hover:bg-black group-hover:opacity-100"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </Carousel>
  );
}
