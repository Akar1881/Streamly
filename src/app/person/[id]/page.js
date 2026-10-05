import { notFound } from 'next/navigation';
import Image from 'next/image';
import site from '@config/site';
import { getPerson } from '@/lib/tmdb/people';
import { parseId, truncate, year } from '@/lib/format';
import { profileUrl } from '@/lib/images';
import MediaGrid from '@/components/media/MediaGrid';
import Icon from '@/components/ui/Icon';

export const revalidate = 21600;

async function load(params) {
  const { id } = await params;
  const tmdbId = parseId(id);
  if (!tmdbId) notFound();

  try {
    return await getPerson(tmdbId);
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }) {
  const person = await load(params);
  return {
    title: person.name,
    description: truncate(person.biography, 160) || `${person.name} on ${site.brand.name}`,
  };
}

export default async function PersonPage({ params }) {
  if (!site.features.people) notFound();

  const person = await load(params);
  const image = profileUrl(person.profilePath, 'h632');

  // Acting roles first; fall back to crew credits for directors and writers.
  const credits = person.cast.length > 0 ? person.cast : person.crew;

  const facts = [
    ['Known for', person.knownFor],
    ['Born', person.birthday ? year(person.birthday) : null],
    ['Died', person.deathday ? year(person.deathday) : null],
    ['Place of birth', person.placeOfBirth],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <header className="grid gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div
          className="relative mx-auto aspect-[2/3] w-40 overflow-hidden
            rounded-[var(--radius-card)] border border-line bg-card sm:mx-0 sm:w-full"
        >
          {image ? (
            <Image src={image} alt={person.name} fill sizes="200px" className="object-cover" priority />
          ) : (
            <div className="grid h-full place-items-center text-muted">
              <Icon name="users" size={32} />
            </div>
          )}
        </div>

        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{person.name}</h1>

          {facts.length > 0 && (
            <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-0.5 text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {person.biography && (
            <p className="mt-5 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted">
              {truncate(person.biography, 900)}
            </p>
          )}
        </div>
      </header>

      {credits.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-semibold tracking-tight sm:text-2xl">
            Known for
          </h2>
          <MediaGrid items={credits.slice(0, 48)} />
        </section>
      )}
    </div>
  );
}
