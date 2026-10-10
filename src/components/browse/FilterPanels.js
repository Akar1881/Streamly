'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { fetchTmdb } from '@/lib/tmdb/browser';
import RangeSlider from './RangeSlider';

/**
 * ============================================================================
 *  FILTER PANELS
 * ============================================================================
 *  The body of each filter dialog. Every panel is controlled: it takes the
 *  current draft value and calls `onChange` with a new one. Nothing here
 *  touches the URL — the dialog only commits on Apply.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 *  Sort — a plain radio list.
 * ------------------------------------------------------------------------- */
export function SortPanel({ options = [], value, onChange }) {
  return (
    <div className="space-y-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex w-full items-center gap-3 rounded-[var(--radius-button)] border
              px-4 py-3 text-left text-sm transition-colors
              ${active ? 'border-line bg-card text-text' : 'border-line/60 bg-card/40 text-muted hover:bg-card'}`}
          >
            <span
              className={`grid size-4 shrink-0 place-items-center rounded-full border-2
                ${active ? 'border-text' : 'border-muted'}`}
            >
              {active && <span className="size-2 rounded-full bg-text" />}
            </span>
            <span className={active ? 'font-medium' : ''}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Genre — include with "+", exclude with "−".
 * ------------------------------------------------------------------------- */
export function GenrePanel({ genres = [], include = [], exclude = [], onChange }) {
  const toggle = (list, id) =>
    list.includes(id) ? list.filter((value) => value !== id) : [...list, id];

  /** A genre cannot be both included and excluded. */
  function include_(id) {
    const next = toggle(include, id);
    onChange({ include: next, exclude: exclude.filter((value) => value !== id) });
  }

  function exclude_(id) {
    const next = toggle(exclude, id);
    onChange({ include: include.filter((value) => value !== id), exclude: next });
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {genres.map((genre) => {
        const id = String(genre.id);
        const included = include.includes(id);
        const excluded = exclude.includes(id);

        return (
          <div
            key={id}
            className={`flex items-center justify-between gap-2 rounded-[var(--radius-button)]
              border bg-card px-4 py-2 transition-colors
              ${included || excluded ? 'border-muted' : 'border-line/60'}`}
          >
            <button
              type="button"
              onClick={() => include_(id)}
              className={`flex-1 truncate text-left text-sm ${included ? 'text-text' : 'text-muted'}`}
            >
              {genre.name}
            </button>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => include_(id)}
                aria-label={`Include ${genre.name}`}
                aria-pressed={included}
                className="grid size-6 place-items-center rounded-full text-muted
                  transition-colors hover:text-text"
              >
                {included ? (
                  <span className="grid size-5 place-items-center rounded-full bg-accent text-accent-text">
                    <Icon name="check" size={12} />
                  </span>
                ) : (
                  <Icon name="plus" size={15} />
                )}
              </button>

              <button
                type="button"
                onClick={() => exclude_(id)}
                aria-label={`Exclude ${genre.name}`}
                aria-pressed={excluded}
                className="grid size-6 place-items-center rounded-full text-muted
                  transition-colors hover:text-text"
              >
                {excluded ? (
                  <span className="grid size-5 place-items-center rounded-full bg-muted text-bg">
                    <Icon name="minus" size={12} />
                  </span>
                ) : (
                  <Icon name="minus" size={15} />
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Ranges — year, rating and runtime share one layout.
 * ------------------------------------------------------------------------- */

/** A number in a labelled card, matching the "From / To" boxes in the design. */
function NumberField({ label, value, onChange, min, max }) {
  return (
    <label
      className="block rounded-[var(--radius-button)] border border-line bg-card px-3.5 py-2
        focus-within:border-muted"
    >
      <span className="block text-xs text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-transparent text-sm text-text outline-none
          [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
          [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

export function RangePanel({
  bounds,
  from,
  to,
  onChange,
  fromLabel,
  toLabel,
  presets = [],
}) {
  const active = (preset) =>
    Number(from) === preset.from && Number(to) === preset.to;

  return (
    <div className="space-y-5">
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(String(preset.from), String(preset.to))}
              className={`h-9 rounded-[var(--radius-pill)] border px-4 text-sm transition-colors
                ${
                  active(preset)
                    ? 'border-muted bg-card text-text'
                    : 'border-line/60 text-muted hover:bg-card hover:text-text'
                }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={fromLabel}
          value={from}
          min={bounds.min}
          max={bounds.max}
          onChange={(value) => onChange(value, to)}
        />
        <NumberField
          label={toLabel}
          value={to}
          min={bounds.min}
          max={bounds.max}
          onChange={(value) => onChange(from, value)}
        />
      </div>

      <RangeSlider
        min={bounds.min}
        max={bounds.max}
        step={bounds.step ?? 1}
        from={from}
        to={to}
        marks={bounds.marks ?? []}
        onChange={onChange}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Language & region — two rows that each open a searchable list.
 * ------------------------------------------------------------------------- */
export function LanguagePanel({
  language,
  country,
  languages = [],
  countries = [],
  onChange,
}) {
  const [openList, setOpenList] = useState(null);

  const label = (list, value) =>
    list.find((option) => String(option.value) === String(value))?.label;

  const rows = [
    {
      key: 'language',
      title: 'Original Language',
      empty: 'Any Language',
      search: 'Search languages or codes',
      options: languages,
      value: language,
    },
    {
      key: 'country',
      title: 'Country of Origin',
      empty: 'Any Country',
      search: 'Search countries or codes',
      options: countries,
      value: country,
    },
  ];

  const current = rows.find((row) => row.key === openList);

  return (
    <>
      <div className="space-y-3">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => setOpenList(row.key)}
            className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-button)]
              border border-line bg-card px-4 py-3 text-left transition-colors hover:bg-card-hover"
          >
            <span className="min-w-0">
              <span className="block text-sm text-text">{row.title}</span>
              <span className="block truncate text-sm text-muted">
                {label(row.options, row.value) ?? row.empty}
              </span>
            </span>
            <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
          </button>
        ))}
      </div>

      {current && (
        <ListDialog
          title={current.title}
          subtitle="Filter by original language and country of origin."
          placeholder={current.search}
          emptyLabel={current.empty}
          options={current.options}
          value={current.value}
          onSelect={(value) => {
            onChange({ [current.key]: value ?? '' });
            setOpenList(null);
          }}
          onClose={() => setOpenList(null)}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
 *  Company — searched on demand, because TMDB has no "list every company".
 * ------------------------------------------------------------------------- */
export function CompanyPanel({ selected = [], seed = [], names = {}, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      fetchTmdb('search/company', { query: term })
        .then((data) =>
          (data?.results ?? [])
            .slice(0, 20)
            .map((company) => ({ value: String(company.id), label: company.name })),
        )
        .catch(() => [])
        .then((list) => {
          if (!cancelled) setResults(list);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const options = query.trim() ? results : seed;

  function toggle(id) {
    onChange(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex h-10 items-center gap-2 rounded-[var(--radius-pill)] border border-line
        bg-card px-4 focus-within:border-muted">
        <Icon name="search" size={15} className="shrink-0 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search companies"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent text-sm text-text placeholder:text-muted outline-none"
        />
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((id) => (
            <Chip key={id} label={labelOf(options, seed, names, id)} onRemove={() => toggle(id)} />
          ))}
        </div>
      )}

      {/* No scroller of its own: the dialog body is the one that scrolls, so
          there is a single place to drag on a touch screen. */}
      <div className="space-y-2">
        {options.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {loading ? 'Searching…' : 'No companies found'}
          </p>
        ) : (
          options.map((company) => {
            const active = selected.includes(String(company.value));
            return (
              <button
                key={company.value}
                type="button"
                onClick={() => toggle(String(company.value))}
                className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-button)]
                  border bg-card px-4 py-2.5 text-left text-sm transition-colors
                  ${active ? 'border-muted text-text' : 'border-line/60 text-muted hover:text-text'}`}
              >
                <span className="truncate">{company.label}</span>
                {active && <Icon name="check" size={15} className="shrink-0 text-text" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/** A company's name is only known once it has been seen in a list, or resolved on the server. */
function labelOf(options, seed, names, id) {
  return (
    [...options, ...seed].map((option) => ({ value: option.value, label: option.label }))
      .find((option) => String(option.value) === String(id))?.label ??
    names[id] ??
    id
  );
}

/* ---------------------------------------------------------------------------
 *  Choice list — a plain single-select list, used by the network filter.
 * ------------------------------------------------------------------------- */
export function ChoiceList({ options = [], value, onChange, emptyLabel }) {
  return (
    <div className="space-y-1.5">
      {emptyLabel && (
        <ListRow label={emptyLabel} active={!value} onClick={() => onChange('')} />
      )}
      {options.map((option) => (
        <ListRow
          key={option.value}
          label={option.label}
          active={String(option.value) === String(value)}
          onClick={() => onChange(String(option.value))}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Searchable list — the sub-dialog behind language and country.
 * ------------------------------------------------------------------------- */
function ListDialog({ title, subtitle, placeholder, emptyLabel, options, value, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();

  const visible = term
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(term) ||
          String(option.value).toLowerCase().includes(term),
      )
    : options;

  // Captured, so Escape here beats the dialog this list sits on top of — a
  // bubble-phase handler would see the same event and close both.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto
        bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[calc(90dvh-2rem)] w-full max-w-md flex-col
          rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-full
              text-muted transition-colors hover:bg-card hover:text-text"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="mt-4 mb-3 flex h-10 shrink-0 items-center gap-2 rounded-[var(--radius-pill)]
          border border-line bg-card px-4 focus-within:border-muted">
          <Icon name="search" size={15} className="shrink-0 text-muted" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent text-sm text-text placeholder:text-muted outline-none"
          />
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          <ListRow
            label={emptyLabel}
            active={!value}
            onClick={() => onSelect('')}
          />
          {visible.map((option) => (
            <ListRow
              key={option.value}
              label={option.label}
              active={String(option.value) === String(value)}
              onClick={() => onSelect(String(option.value))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ListRow({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-button)]
        border bg-card px-4 py-2.5 text-left text-sm transition-colors
        ${active ? 'border-muted text-text' : 'border-line/60 text-muted hover:text-text'}`}
    >
      <span className="truncate">{label}</span>
      {active && <Icon name="check" size={15} className="shrink-0 text-text" />}
    </button>
  );
}

/** A removable pill, used for the selected companies and the active filters. */
export function Chip({ label, onRemove, tone = 'default' }) {
  return (
    <span
      className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-pill)] border
        px-3 text-xs
        ${tone === 'muted' ? 'border-line/60 text-muted' : 'border-line bg-card text-text'}`}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="-mr-1 grid size-4 place-items-center rounded-full text-muted
          transition-colors hover:text-text"
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}
