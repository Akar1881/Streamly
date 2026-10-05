import Link from 'next/link';
import Image from 'next/image';
import site from '@config/site';
import { profileUrl } from '@/lib/images';
import { toSlugId } from '@/lib/format';
import Icon from '@/components/ui/Icon';

/**
 * A cast or crew member. `subtitle` carries the character name for cast and
 * the job title for crew.
 */
export default function PersonCard({ person, subtitle }) {
  const image = profileUrl(person.profile_path ?? person.profilePath);
  const label = subtitle ?? person.character ?? person.job ?? '';

  const content = (
    <div
      className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line
        bg-card p-2.5 transition-colors hover:bg-card-hover"
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-surface">
        {image ? (
          <Image src={image} alt={person.name} fill sizes="48px" className="object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-muted">
            <Icon name="users" size={18} />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-text">{person.name}</p>
        {label && <p className="truncate text-xs text-muted">{label}</p>}
      </div>
    </div>
  );

  if (!site.features.people) return content;

  return (
    <Link href={`/person/${toSlugId(person.id, person.name)}`} className="block">
      {content}
    </Link>
  );
}
