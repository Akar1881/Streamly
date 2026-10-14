'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import useDebounce from '@/hooks/useDebounce';
import { fetchTmdb } from '@/lib/tmdb/browser';
import { posterUrl, profileUrl } from '@/lib/images';
import { toSlugId, year } from '@/lib/format';
import Icon from '@/components/ui/Icon';

/** Where a result links to, by type. */
function hrefFor(item) {
  if (item.media_type === 'person') return `/person/${toSlugId(item.id, item.name)}`;
  const title = item.title ?? item.name;
  return `/${item.media_type === 'tv' ? 'tv' : 'movies'}/${toSlugId(item.id, title)}`;
}

/**
 * Header search with a type-ahead dropdown. Submitting (or pressing Enter)
 * goes to the full `/search` page.
 */
export default function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const debounced = useDebounce(query, 350);
  const containerRef = useRef(null);

  // --- fetch suggestions ---------------------------------------------------
  useEffect(() => {
    const term = debounced.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    fetchTmdb('search/multi', { query: term }, { signal: controller.signal })
      .then((data) => {
        setResults(
          (data.results ?? [])
            .filter((item) => ['movie', 'tv', 'person'].includes(item.media_type))
            .slice(0, 7),
        );
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setResults([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [debounced]);

  // --- close when clicking outside ----------------------------------------
  useEffect(() => {
    function onPointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  function submit(event) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="site-search">
          Search
        </label>

        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />

          <input
            id="site-search"
            type="search"
            value={query}
            placeholder="Search for movies, TV shows, actors and more…"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
            className="h-10 w-full rounded-[var(--radius-pill)] border border-line bg-card
              pl-10 pr-10 text-sm text-text placeholder:text-muted
              focus:border-muted focus:outline-none"
          />

          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setResults([]);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      </form>

      {/* ---------------- suggestions ---------------- */}
      {showDropdown && (
        <div
          className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-[var(--radius-card)]
            border border-line bg-surface shadow-2xl"
        >
          {loading && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted">Searching…</p>
          )}

          {!loading && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted">
              No results for “{query.trim()}”
            </p>
          )}

          <ul>
            {results.map((item) => {
              const isPerson = item.media_type === 'person';
              const image = isPerson
                ? profileUrl(item.profile_path)
                : posterUrl(item.poster_path);
              const label = item.title ?? item.name;
              const meta = isPerson
                ? item.known_for_department
                : [item.media_type === 'tv' ? 'TV' : 'Movie', year(item.release_date ?? item.first_air_date)]
                    .filter(Boolean)
                    .join(' · ');

              return (
                <li key={`${item.media_type}-${item.id}`}>
                  <Link
                    href={hrefFor(item)}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-card"
                  >
                    <div
                      className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-card"
                    >
                      {image && (
                        <Image
                          src={image}
                          alt=""
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm text-text">{label}</p>
                      <p className="truncate text-xs text-muted">{meta}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={submit}
            className="w-full border-t border-line px-4 py-2.5 text-sm text-muted
              transition-colors hover:bg-card hover:text-text"
          >
            See all results for “{query.trim()}”
          </button>
        </div>
      )}
    </div>
  );
}
