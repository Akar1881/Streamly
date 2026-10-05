import Image from 'next/image';
import site from '@config/site';
import { profileUrl } from '@/lib/images';
import { formatDate } from '@/lib/format';
import Icon from '@/components/ui/Icon';

/**
 * Read-only reviews from TMDB, shown in the detail page's right column.
 *
 * There is no way to post: the site has no accounts. This replaces the
 * user-generated comments panel, keeping the layout and the "no reviews yet"
 * empty state.
 */
export default function ReviewsPanel({ reviews = [], title }) {
  if (!site.detail.showReviews) return null;

  const shown = reviews.slice(0, site.detail.reviewsLimit);

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-card p-4">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="info" size={16} />
          Comments &amp; Reviews
        </h2>

        {reviews.length > 0 && (
          <span className="text-xs text-muted">
            {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
          </span>
        )}
      </header>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-line text-muted">
            <Icon name="info" size={18} />
          </div>
          <p className="text-sm font-medium">No reviews yet</p>
          <p className="max-w-xs text-xs text-muted">
            Nobody has written about {title} on TMDB so far.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {shown.map((review) => {
            const avatar = profileUrl(review.author_details?.avatar_path);
            const rating = review.author_details?.rating;

            return (
              <li key={review.id} className="border-t border-line pt-4 first:border-0 first:pt-0">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="relative size-8 shrink-0 overflow-hidden rounded-full bg-surface">
                      {avatar ? (
                        <Image src={avatar} alt="" fill sizes="32px" className="object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-xs text-muted">
                          {review.author?.[0]?.toUpperCase() ?? '?'}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {review.author_details?.name ?? review.author}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDate(review.created_at)}
                      </p>
                    </div>
                  </div>

                  {rating && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                      <Icon name="star" size={11} className="fill-star text-star" />
                      {rating}/10
                    </span>
                  )}
                </div>

                <p className="line-clamp-3 text-sm leading-relaxed text-muted">{review.content}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
