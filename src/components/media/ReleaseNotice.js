import Icon from '@/components/ui/Icon';
import { daysUntil, formatDate, formatDaysAway } from '@/lib/format';

/**
 * Replaces the player when the thing being watched does not exist yet — a film
 * that has not opened, or an episode that has not aired.
 *
 * With a known date it gives a countdown; without one it just says so, rather
 * than promising a date that may never have been announced.
 *
 * @param {string} title       the movie or episode name
 * @param {string} date        ISO "YYYY-MM-DD", may be null
 * @param {string} noun        'movie' | 'episode' — wording only
 * @param {string} participle  'released' | 'aired' — wording only
 */
export default function ReleaseNotice({
  title,
  date,
  noun = 'movie',
  participle = 'released',
}) {
  const days = daysUntil(date);
  const countdown = formatDaysAway(days);
  const label = noun === 'movie' ? 'movie' : 'episode';

  return (
    <div
      className="grid aspect-video place-items-center rounded-[var(--radius-card)] border
        border-line bg-card px-6 text-center"
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="grid size-14 place-items-center rounded-full border border-line bg-surface text-muted">
          <Icon name="calendar" size={24} />
        </div>

        <p className="text-base font-medium">Not {participle} yet</p>

        <p className="text-sm leading-relaxed text-muted">
          <span className="font-medium text-text">{title}</span> hasn&apos;t been {participle} yet —
          you can&apos;t watch this {label} until then.{' '}
          {countdown ? (
            <>
              It will {noun === 'movie' ? 'be released' : 'air'}{' '}
              <span className="font-semibold text-text">{countdown}</span>
              {date ? `, on ${formatDate(date)}` : ''}.
            </>
          ) : (
            <>A {noun === 'movie' ? 'release' : 'air'} date hasn&apos;t been announced.</>
          )}
        </p>
      </div>
    </div>
  );
}
