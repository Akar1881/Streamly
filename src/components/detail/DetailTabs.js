'use client';

import { useState } from 'react';
import Image from 'next/image';
import { backdropUrl, posterUrl } from '@/lib/images';
import PosterCard from '@/components/media/PosterCard';
import { collectionMeta } from './Overview';
import Icon from '@/components/ui/Icon';

/**
 * The tab strip on a detail page: Overview · Details · Images · Videos
 * (· Collection for films that belong to a franchise).
 *
 * Tab panels are passed in already rendered from the server component, so
 * switching tabs is instant with no extra request. Tabs whose content is empty
 * are hidden rather than shown blank.
 */
export default function DetailTabs({ tabs, initial = 'overview' }) {
  const available = tabs.filter((tab) => tab.available !== false);
  const [active, setActive] = useState(
    available.some((tab) => tab.id === initial) ? initial : available[0]?.id,
  );

  const panel = available.find((tab) => tab.id === active);

  return (
    <div className="mt-8">
      <div
        role="tablist"
        className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
      >
        {available.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`shrink-0 rounded-[var(--radius-pill)] px-4 py-2 text-sm transition-colors
              ${
                active === tab.id
                  ? 'border border-line bg-card text-text'
                  : 'border border-transparent text-muted hover:text-text'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {panel ? (
          panel.content
        ) : (
          <p className="py-10 text-center text-sm text-muted">Nothing to show here yet.</p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  PANEL BUILDERS                                                            */
/*  Exported so the server components can compose them without duplication.    */
/* -------------------------------------------------------------------------- */

/** A responsive image gallery of backdrops or posters. */
export function ImageGallery({ images, aspect = 'video', emptyLabel = 'No images available.' }) {
  if (!images?.length) {
    return <p className="py-10 text-center text-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <div
      className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${
        aspect === 'video' ? '' : 'auto-rows-auto'
      }`}
    >
      {images.slice(0, 24).map((image) => {
        const source =
          aspect === 'video' ? backdropUrl(image.file_path, 'w780') : posterUrl(image.file_path, 'w342');

        return (
          <div
            key={image.file_path}
            className={`relative overflow-hidden rounded-[var(--radius-card)] border
              border-line bg-card ${aspect === 'video' ? 'aspect-video' : 'aspect-[2/3]'}`}
          >
            <Image
              src={source}
              alt=""
              fill
              sizes="(max-width: 640px) 45vw, 25vw"
              className="object-cover transition-transform duration-500 hover:scale-105"
            />
          </div>
        );
      })}
    </div>
  );
}

/** A grid of YouTube videos. Nothing is loaded until a thumbnail is clicked. */
export function VideoGrid({ videos }) {
  const [playing, setPlaying] = useState(null);

  if (!videos?.length) {
    return <p className="py-10 text-center text-sm text-muted">No videos available.</p>;
  }

  if (playing) {
    return (
      <div className="space-y-3">
        <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-black">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${playing}?autoplay=1&rel=0`}
            title="Video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>

        <button
          type="button"
          onClick={() => setPlaying(null)}
          className="text-sm text-muted transition-colors hover:text-text"
        >
          ← Back to all videos
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((video) => (
        <button
          key={video.id}
          type="button"
          onClick={() => setPlaying(video.key)}
          className="group overflow-hidden rounded-[var(--radius-card)] border border-line
            bg-card text-left transition-colors hover:bg-card-hover"
        >
          <div className="relative aspect-video">
            {/* Served straight from YouTube's CDN — the global
                `images.unoptimized` in next.config.mjs keeps it out of
                Vercel's optimizer, which is why no `unoptimized` prop is
                needed here any more. */}
            <Image
              src={`https://i.ytimg.com/vi/${video.key}/hqdefault.jpg`}
              alt={video.name}
              fill
              sizes="(max-width: 640px) 90vw, 33vw"
              className="object-cover"
            />
            <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="grid size-11 place-items-center rounded-full bg-white/90 text-black">
                <Icon name="play" size={18} className="translate-x-px fill-black" />
              </span>
            </div>
          </div>

          <div className="p-3">
            <p className="line-clamp-2 text-sm font-medium">{video.name}</p>
            <p className="mt-0.5 text-xs text-muted">{video.type}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

/** All the films in a franchise, in release order. */
export function CollectionPanel({ collection }) {
  if (!collection) {
    return <p className="py-10 text-center text-sm text-muted">Not part of a collection.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{collection.name}</h3>
        <p className="text-sm text-muted">{collectionMeta(collection)}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {collection.items.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
