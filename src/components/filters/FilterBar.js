'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import site from '@config/site';
import {
  POPULAR_NETWORKS,
  RATING_OPTIONS,
  RUNTIME_OPTIONS,
  SORT_OPTIONS,
  yearOptions,
} from '@/lib/tmdb/filters';
import { fetchTmdb } from '@/lib/tmdb/browser';
import Dropdown from '@/components/ui/Dropdown';
import Icon from '@/components/ui/Icon';
import AllFiltersPanel from './AllFiltersPanel';

/**
 * ============================================================================
 *  FILTER BAR
 * ============================================================================
 *  Every control writes to the URL query string rather than to component
 *  state. That means:
 *    - a filtered view is shareable and survives a reload
 *    - the server re-runs the query and streams fresh results
 *    - the back button steps through filter changes naturally
 *
 *  Which controls appear, and in what order, comes from
 *  `site.browse.movie.filters` / `site.browse.tv.filters`.
 *
 *  The same controls are rendered twice — once in the row and once inside the
 *  "All Filters" panel. Each instance keeps its own open/closed state but they
 *  all read and write the one URL, so they can never disagree.
 *
 *  Genres and languages arrive as props from the server, because the browse
 *  page already has them. Only the company lookup is done in the browser, since
 *  TMDB has no "list every company" endpoint — that one is searched as you type.
 * ============================================================================
 */
export default function FilterBar({ mediaType, genres = [], languages = [] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [panelOpen, setPanelOpen] = useState(false);

  const config = site.browse[mediaType];
  const filters = config.filters;

  /** Current filter state, read straight from the URL. */
  const current = useMemo(
    () => ({
      sort: searchParams.get('sort') ?? '',
      genre: searchParams.get('genre') ?? '',
      year: searchParams.get('year') ?? '',
      rating: searchParams.get('rating') ?? '',
      runtime: searchParams.get('runtime') ?? '',
      language: searchParams.get('language') ?? '',
      company: searchParams.get('company') ?? '',
      network: searchParams.get('network') ?? '',
    }),
    [searchParams],
  );

  const years = useMemo(() => yearOptions(), []);

  /** Writes the whole query string back to the URL. */
  const push = useCallback(
    (params) => {
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  /** Applies one change. `null` or `''` clears that filter. */
  const setFilter = useCallback(
    (key, value) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value === null || value === '') params.delete(key);
      else params.set(key, value);

      // Any change invalidates how far the visitor had scrolled.
      params.delete('page');
      push(params);
    },
    [searchParams, push],
  );

  const clearAll = useCallback(() => push(new URLSearchParams()), [push]);

  /** Looks a company up by name. Networks come from the list in the config. */
  const searchCompanies = useCallback(async (query) => {
    const data = await fetchTmdb('search/company', { query });
    return (data?.results ?? [])
      .slice(0, 20)
      .map((company) => ({ value: String(company.id), label: company.name }));
  }, []);

  const activeCount = Object.entries(current).filter(
    ([key, value]) => value && key !== 'sort',
  ).length;

  const CONTROLS = {
    sort: (
      <Dropdown
        key="sort"
        label="Sort"
        icon="arrow-up-down"
        options={SORT_OPTIONS}
        value={current.sort}
        onChange={(value) => setFilter('sort', value)}
      />
    ),
    genre: (
      <Dropdown
        key="genre"
        label="Genre"
        icon="tag"
        options={genres.map((genre) => ({ value: String(genre.id), label: genre.name }))}
        value={current.genre}
        onChange={(value) => setFilter('genre', value)}
        searchable
      />
    ),
    year: (
      <Dropdown
        key="year"
        label="Year"
        icon="calendar"
        options={years}
        value={current.year}
        onChange={(value) => setFilter('year', value)}
        searchable
      />
    ),
    rating: (
      <Dropdown
        key="rating"
        label="Rating"
        icon="star"
        options={RATING_OPTIONS}
        value={current.rating}
        onChange={(value) => setFilter('rating', value)}
      />
    ),
    runtime: (
      <Dropdown
        key="runtime"
        label="Runtime"
        icon="clock"
        options={RUNTIME_OPTIONS}
        value={current.runtime}
        onChange={(value) => setFilter('runtime', value)}
      />
    ),
    language: (
      <Dropdown
        key="language"
        label="Language"
        icon="globe"
        options={languages}
        value={current.language}
        onChange={(value) => setFilter('language', value)}
        searchable
      />
    ),
    company: (
      <Dropdown
        key="company"
        label="Company"
        icon="building"
        options={[]}
        value={current.company}
        onChange={(value) => setFilter('company', value)}
        searchable
        onSearch={searchCompanies}
      />
    ),
    network: (
      <Dropdown
        key="network"
        label="Network"
        icon="tv-minimal"
        options={POPULAR_NETWORKS}
        value={current.network}
        onChange={(value) => setFilter('network', value)}
        searchable
      />
    ),
  };

  const controls = filters.map((key) => CONTROLS[key]).filter(Boolean);

  return (
    <>
      <div className="mb-6">
        <div
          className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4
            sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        >
          {/* Opens the full set of controls, which is the only way to reach
              them all comfortably on a phone. */}
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius-pill)]
              border border-line bg-card px-3.5 text-sm text-text transition-colors
              hover:bg-card-hover"
          >
            <Icon name="sliders" size={15} />
            All Filters
            {activeCount > 0 && (
              <span
                className="grid size-5 place-items-center rounded-full bg-accent text-[11px]
                  font-semibold text-accent-text"
              >
                {activeCount}
              </span>
            )}
          </button>

          {controls}

          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)]
                px-3 text-sm text-muted transition-colors hover:text-text"
            >
              <Icon name="x" size={14} />
              Clear all
            </button>
          )}
        </div>
      </div>

      {panelOpen && (
        <AllFiltersPanel
          controls={controls}
          activeCount={activeCount}
          onClear={clearAll}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  );
}
