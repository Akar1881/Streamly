import Link from 'next/link';
import Image from 'next/image';
import { search, SEARCH_TABS } from '@/lib/tmdb/search';
import { profileUrl } from '@/lib/images';
import { toSlugId } from '@/lib/format';
import MediaGrid from '@/components/media/MediaGrid';
import EmptyState from '@/components/ui/EmptyState';
import Icon from '@/components/ui/Icon';

export const metadata = { title: 'Search' };

/** People need a portrait card rather than a poster. */
function PersonResult({ person }) {
  const image = profileUrl(person.profilePath, 'w342');

  return (
    <Link href={`/person/${toSlugId(person.id, person.name)}`} className="group block">
      <div
        className="relative aspect-[2/3] overflow-hidden rounded-[var(--radius-card)]
          border border-line bg-card transition-colors group-hover:border-muted/40"
      >
        {image ? (
          <Image
            src={image}
            alt={person.name}
            fill
            sizes="(max-width: 640px) 45vw, 15vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full place-items-center text-muted">
            <Icon name="users" size={26} />
          </div>
        )}
      </div>

      <p className="mt-2 line-clamp-1 text-sm text-text">{person.name}</p>
      <p className="text-xs text-muted">{person.knownFor}</p>
    </Link>
  );
}

export default async function SearchPage({ searchParams }) {
  const { q = '', type = 'all', page = '1' } = await searchParams;
  const query = q.trim();
  const currentPage = Number(page) || 1;

  const results = query
    ? await search(query, { type, page: currentPage }).catch(() => null)
    : null;

  const people = results?.items.filter((item) => item.mediaType === 'person') ?? [];
  const titles = results?.items.filter((item) => item.mediaType !== 'person') ?? [];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {query ? `Results for “${query}”` : 'Search'}
        </h1>
        {results && (
          <p className="mt-1 text-sm text-muted">
            {results.totalResults.toLocaleString('en-US')} results
          </p>
        )}
      </header>

      {/* ---------------- type tabs ---------------- */}
      {query && (
        <div className="no-scrollbar mb-6 flex items-center gap-2 overflow-x-auto">
          {SEARCH_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={`/search?q=${encodeURIComponent(query)}&type=${tab.value}`}
              className={`shrink-0 rounded-[var(--radius-pill)] border px-4 py-2 text-sm
                transition-colors
                ${
                  type === tab.value
                    ? 'border-line bg-card text-text'
                    : 'border-transparent text-muted hover:text-text'
                }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      )}

      {/* ---------------- results ---------------- */}
      {!query && (
        <EmptyState
          icon="search"
          title="Search for something"
          description="Find movies, TV shows and the people who make them."
        />
      )}

      {query && !results && (
        <EmptyState
          icon="alert-circle"
          title="Search failed"
          description="Something went wrong talking to TMDB. Try again in a moment."
        />
      )}

      {results && results.items.length === 0 && (
        <EmptyState
          icon="search"
          title={`No results for “${query}”`}
          description="Check the spelling, or try a shorter search term."
        />
      )}

      <div className="space-y-10">
        {titles.length > 0 && <MediaGrid items={titles} />}

        {people.length > 0 && (
          <section>
            {titles.length > 0 && <h2 className="mb-4 text-xl font-semibold">People</h2>}
            <div
              className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4
                lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
            >
              {people.map((person) => (
                <PersonResult key={person.id} person={person} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ---------------- paging ---------------- */}
      {results && results.totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3">
          {currentPage > 1 && (
            <Link
              href={`/search?q=${encodeURIComponent(query)}&type=${type}&page=${currentPage - 1}`}
              className="rounded-[var(--radius-button)] border border-line bg-card px-4 py-2
                text-sm transition-colors hover:bg-card-hover"
            >
              Previous
            </Link>
          )}

          <span className="text-sm text-muted">
            Page {currentPage} of {results.totalPages}
          </span>

          {currentPage < results.totalPages && (
            <Link
              href={`/search?q=${encodeURIComponent(query)}&type=${type}&page=${currentPage + 1}`}
              className="rounded-[var(--radius-button)] border border-line bg-card px-4 py-2
                text-sm transition-colors hover:bg-card-hover"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
