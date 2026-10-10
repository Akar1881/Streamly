'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  BOUNDS,
  POPULAR_COMPANIES,
  POPULAR_NETWORKS,
  RUNTIME_PRESETS,
  countActiveFilters,
  emptyFilters,
  serialiseBrowseFilters,
  sortOptions,
} from '@/lib/tmdb/filters';
import Icon from '@/components/ui/Icon';
import FilterDialog from './FilterDialog';
import {
  ChoiceList,
  Chip,
  CompanyPanel,
  GenrePanel,
  LanguagePanel,
  RangePanel,
  SortPanel,
} from './FilterPanels';

/**
 * ============================================================================
 *  FILTER BAR
 * ============================================================================
 *  The row of filter pills above the results on /movies and /tv, the chips
 *  showing what is currently applied, and the dialogs behind each pill.
 *
 *  Everything is committed to the query string, never to long-lived state:
 *    - a filtered view is shareable and survives a reload
 *    - the server re-runs the query and streams fresh results
 *    - the back button steps through filter changes naturally
 *
 *  A dialog edits a *draft*. Apply writes it to the URL; Cancel, Escape or a
 *  click on the backdrop throw it away, so the results never move until the
 *  visitor says so.
 *
 *  The active values arrive as props, rendered by the server from the query
 *  string. That keeps this component free of `useSearchParams`, so the pills
 *  and chips are correct in the first paint.
 * ============================================================================
 */
export default function FilterBar({
  mediaType,
  filters,
  chips = [],
  genres = [],
  languages = [],
  countries = [],
  companyNames = {},
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [draft, setDraft] = useState(filters);
  const [openKey, setOpenKey] = useState(null);

  const activeCount = countActiveFilters(filters);

  const commit = useCallback(
    (next) => {
      const query = serialiseBrowseFilters(next).toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  /** Opens a dialog with a fresh draft copied from what is applied. */
  function open(key) {
    setDraft(filters);
    setOpenKey(key);
  }

  function apply() {
    commit(draft);
    setOpenKey(null);
  }

  const edit = (patch) => setDraft((current) => ({ ...current, ...patch }));

  /** Dropping a chip acts immediately — there is no dialog to apply. */
  function removeChip(chip) {
    const next = { ...filters };

    if (chip.value != null) {
      const [key] = chip.keys;
      next[key] = (filters[key] ?? []).filter((value) => String(value) !== String(chip.value));
    } else {
      for (const key of chip.keys) next[key] = Array.isArray(filters[key]) ? [] : '';
    }
    commit(next);
  }

  /**
   * One entry per filter: how its pill looks, the dialog it opens, and the
   * panel inside it. The "All Filters" dialog re-uses the same panels.
   */
  const SECTIONS = {
    sort: {
      label: 'Sort',
      icon: 'arrow-up-down',
      heading: 'Sort By',
      title: 'Sort By',
      subtitle: 'Choose how to sort the results.',
      clearLabel: 'Reset',
      active: (f) => Boolean(f.sort),
      body: (f, set) => (
        <SortPanel
          options={sortOptions(mediaType)}
          value={f.sort}
          onChange={(value) => set({ sort: value })}
        />
      ),
    },
    genre: {
      label: 'Genre',
      icon: 'tag',
      heading: 'Genre',
      title: 'Filter by Genre',
      subtitle: 'Include or exclude genres to refine your results.',
      clearLabel: 'Clear All',
      active: (f) => f.genre.length > 0 || f.without.length > 0,
      body: (f, set) => (
        <GenrePanel
          genres={genres}
          include={f.genre}
          exclude={f.without}
          onChange={({ include, exclude }) => set({ genre: include, without: exclude })}
        />
      ),
    },
    year: {
      label: 'Year',
      icon: 'calendar',
      heading: 'Year',
      title: 'Filter by Year',
      subtitle: 'Select a release year range.',
      clearLabel: 'Clear All',
      active: (f) => Boolean(f.yearFrom || f.yearTo),
      body: (f, set) => (
        <RangePanel
          bounds={BOUNDS.year}
          from={f.yearFrom}
          to={f.yearTo}
          fromLabel="From"
          toLabel="To"
          onChange={(yearFrom, yearTo) => set({ yearFrom, yearTo })}
        />
      ),
    },
    rating: {
      label: 'Rating',
      icon: 'star',
      heading: 'Rating',
      title: 'Filter by Rating',
      subtitle: 'Select a TMDB user rating range.',
      clearLabel: 'Clear All',
      active: (f) => Boolean(f.ratingFrom || f.ratingTo),
      body: (f, set) => (
        <RangePanel
          bounds={BOUNDS.rating}
          from={f.ratingFrom}
          to={f.ratingTo}
          fromLabel="Min Score"
          toLabel="Max Score"
          onChange={(ratingFrom, ratingTo) => set({ ratingFrom, ratingTo })}
        />
      ),
    },
    runtime: {
      label: 'Runtime',
      icon: 'clock',
      heading: 'Runtime',
      title: 'Runtime',
      subtitle: 'Filter by runtime in minutes.',
      clearLabel: 'Clear All',
      active: (f) => Boolean(f.runtimeFrom || f.runtimeTo),
      body: (f, set) => (
        <RangePanel
          bounds={BOUNDS.runtime}
          from={f.runtimeFrom}
          to={f.runtimeTo}
          fromLabel="Min minutes"
          toLabel="Max minutes"
          presets={RUNTIME_PRESETS}
          onChange={(runtimeFrom, runtimeTo) => set({ runtimeFrom, runtimeTo })}
        />
      ),
    },
    language: {
      label: 'Language',
      icon: 'languages',
      heading: 'Language & Region',
      title: 'Language & Region',
      subtitle: 'Filter by original language and country of origin.',
      clearLabel: 'Clear All',
      active: (f) => Boolean(f.language || f.country),
      body: (f, set) => (
        <LanguagePanel
          language={f.language}
          country={f.country}
          languages={languages}
          countries={countries}
          onChange={(patch) => set(patch)}
        />
      ),
    },
    company: {
      label: 'Company',
      icon: 'factory',
      heading: 'Production Company',
      title: 'Production Company',
      subtitle: 'Filter by production companies.',
      clearLabel: 'Clear All',
      active: (f) => f.company.length > 0,
      body: (f, set) => (
        <CompanyPanel
          selected={f.company}
          seed={POPULAR_COMPANIES}
          names={companyNames}
          onChange={(company) => set({ company })}
        />
      ),
    },
    network: {
      label: 'Network',
      icon: 'tv-minimal',
      heading: 'Network',
      title: 'Network',
      subtitle: 'Filter by the network that airs the show.',
      clearLabel: 'Clear All',
      active: (f) => Boolean(f.network),
      body: (f, set) => (
        <ChoiceList
          options={POPULAR_NETWORKS}
          value={f.network}
          emptyLabel="Any Network"
          onChange={(value) => set({ network: value ?? '' })}
        />
      ),
    },
  };

  const order =
    mediaType === 'tv'
      ? ['sort', 'genre', 'year', 'rating', 'runtime', 'language', 'network', 'company']
      : ['sort', 'genre', 'year', 'rating', 'runtime', 'language', 'company'];

  const current = openKey && openKey !== 'all' ? SECTIONS[openKey] : null;

  return (
    <>
      <div className="mb-4">
        <div
          className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4
            sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        >
          <button
            type="button"
            onClick={() => open('all')}
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

          {order.map((key) => {
            const section = SECTIONS[key];
            const active = section.active(filters);

            return (
              <button
                key={key}
                type="button"
                onClick={() => open(key)}
                className={`flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius-pill)]
                  border px-3.5 text-sm transition-colors
                  ${
                    active
                      ? 'border-muted bg-card text-text'
                      : 'border-line/60 text-muted hover:bg-card hover:text-text'
                  }`}
              >
                <Icon name={section.icon} size={15} />
                {section.label}
              </button>
            );
          })}
        </div>

        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <Chip key={chip.id} label={chip.label} onRemove={() => removeChip(chip)} />
            ))}
            <button
              type="button"
              onClick={() => commit(emptyFilters())}
              className="h-8 rounded-[var(--radius-pill)] border border-line px-3 text-xs
                text-muted transition-colors hover:text-text"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {current && (
        <FilterDialog
          title={current.title}
          subtitle={current.subtitle}
          clearLabel={current.clearLabel}
          onClose={() => setOpenKey(null)}
          onClear={() => setDraft((current) => ({ ...current, ...clearSection(current, openKey) }))}
          onApply={apply}
        >
          {current.body(draft, edit)}
        </FilterDialog>
      )}

      {openKey === 'all' && (
        <FilterDialog
          title="All Filters"
          subtitle="Narrow the catalogue — everything here applies together."
          width="max-w-3xl"
          onClose={() => setOpenKey(null)}
          onClear={() => setDraft(emptyFilters())}
          onApply={apply}
        >
          <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
            {order.map((key) => (
              <section key={key} className="space-y-3">
                <h3 className="text-sm font-medium text-text">{SECTIONS[key].heading}</h3>
                {SECTIONS[key].body(draft, edit)}
              </section>
            ))}
          </div>
        </FilterDialog>
      )}
    </>
  );
}

/**
 * Resets one section of the draft, leaving every other section alone — what the
 * "Clear All" button inside a single-filter dialog is for.
 */
function clearSection(filters, key) {
  switch (key) {
    case 'sort':
      return { sort: '' };
    case 'genre':
      return { genre: [], without: [] };
    case 'year':
      return { yearFrom: '', yearTo: '' };
    case 'rating':
      return { ratingFrom: '', ratingTo: '' };
    case 'runtime':
      return { runtimeFrom: '', runtimeTo: '' };
    case 'language':
      return { language: '', country: '' };
    case 'company':
      return { company: [] };
    case 'network':
      return { network: '' };
    default:
      return {};
  }
}
