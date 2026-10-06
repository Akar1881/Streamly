'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import site from '@config/site';
import { backdropUrl, logoUrl } from '@/lib/images';
import { formatRating, toSlugId, truncate, year } from '@/lib/format';
import Icon from '@/components/ui/Icon';

/**
 * The full-bleed hero at the top of the home page.
 *
 * Shows the title's own logo artwork when TMDB has one, falling back to plain
 * text. Autoplay pauses on hover and is disabled entirely when the visitor
 * prefers reduced motion.
 */
export default function HeroCarousel({ items }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = items?.length ?? 0;
  const go = useCallback((next) => setIndex((current) => (next + count) % count), [count]);

  useEffect(() => {
    const interval = site.home.hero.autoplayMs;
    if (!interval || paused || count <= 1) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const timer = setInterval(() => go(index + 1), interval);
    return () => clearInterval(timer);
  }, [index, paused, count, go]);

  if (!count) return null;

  const active = items[index];
  const href = `/${active.mediaType === 'tv' ? 'tv' : 'movies'}/${toSlugId(active.id, active.title)}`;
  const logo = active.logoPath ? logoUrl(active.logoPath) : null;

  return (
    <section
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Featured titles"
    >
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-card)]
          border border-line bg-card sm:aspect-[21/9] lg:aspect-[2.6/1]"
      >
        {/* Only the active slide is in the DOM, cross-faded by key change. */}
        {items.map((item, slideIndex) => {
          const image = backdropUrl(item.backdropPath);
          if (!image) return null;

          return (
            <Image
              key={item.id}
              src={image}
              alt=""
              fill
              priority={slideIndex === 0}
              sizes="100vw"
              className={`object-cover transition-opacity duration-700
                ${slideIndex === index ? 'opacity-100' : 'opacity-0'}`}
            />
          );
        })}

        {/* readability scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />

        {/* ---------------- content ---------------- */}
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8 lg:p-10">
          <div className="max-w-2xl">
            {/*
              The h1 stays in the DOM even when a logo stands in for it
              visually, hidden with `sr-only` rather than dropped. Without this,
              a hero title that has a TMDB logo takes the whole page's h1 with
              it — and the home page is the one URL that most needs a heading.
            */}
            <h1
              className={
                logo
                  ? 'sr-only'
                  : 'mb-3 text-2xl font-bold text-white drop-shadow-lg sm:text-4xl lg:text-5xl'
              }
            >
              {active.title}
            </h1>

            {/* Decorative: the h1 above already names this title. */}
            {logo && (
              <div className="relative mb-3 h-16 w-48 sm:h-20 sm:w-64 lg:h-24 lg:w-80">
                <Image
                  src={logo}
                  alt=""
                  fill
                  sizes="320px"
                  className="object-contain object-left drop-shadow-lg"
                />
              </div>
            )}

            {/* meta pills */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-white/90 sm:text-sm">
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 backdrop-blur-sm">
                <Icon name={active.mediaType === 'tv' ? 'tv-minimal' : 'clapperboard'} size={13} />
                {active.mediaType === 'tv' ? 'TV' : 'Movie'}
              </span>

              {year(active.releaseDate) && (
                <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 backdrop-blur-sm">
                  <Icon name="calendar" size={13} />
                  {year(active.releaseDate)}
                </span>
              )}

              {formatRating(active.voteAverage) && (
                <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 backdrop-blur-sm">
                  <Icon name="star" size={13} className="fill-star text-star" />
                  {formatRating(active.voteAverage)}
                </span>
              )}
            </div>

            {active.overview && (
              <p className="mb-4 hidden max-w-xl text-sm leading-relaxed text-white/80 sm:block">
                {truncate(active.overview, 180)}
              </p>
            )}

            <Link
              href={href}
              className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-white
                px-5 py-2.5 text-sm font-semibold text-black transition-transform
                hover:scale-[1.03] active:scale-95"
            >
              <Icon name="play" size={16} className="fill-black" />
              Watch now
            </Link>
          </div>
        </div>

        {/* ---------------- arrows ---------------- */}
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Previous slide"
              className="absolute left-3 top-1/2 hidden size-9 -translate-y-1/2 place-items-center
                rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors
                hover:bg-black/70 sm:grid"
            >
              <Icon name="chevron-left" size={18} />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Next slide"
              className="absolute right-3 top-1/2 hidden size-9 -translate-y-1/2 place-items-center
                rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors
                hover:bg-black/70 sm:grid"
            >
              <Icon name="chevron-right" size={18} />
            </button>
          </>
        )}
      </div>

      {/* ---------------- dots ---------------- */}
      {count > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {items.map((item, slideIndex) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setIndex(slideIndex)}
              aria-label={`Go to slide ${slideIndex + 1}`}
              aria-current={slideIndex === index}
              className={`h-1.5 rounded-full transition-all
                ${slideIndex === index ? 'w-6 bg-accent' : 'w-1.5 bg-line hover:bg-muted'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
