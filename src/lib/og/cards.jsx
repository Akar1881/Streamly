import { ImageResponse } from 'next/og';
import site from '@config/site';
import { posterUrl } from '@/lib/images';
import { formatRating, formatRuntime, truncate, year } from '@/lib/format';

/**
 * ============================================================================
 *  SOCIAL SHARE CARDS
 * ============================================================================
 *
 *  Every image a chat app or social network shows when one of our links is
 *  shared is drawn here. `next/og` turns this JSX into a PNG at request time,
 *  so a card carries the real poster, rating and metadata rather than a generic
 *  site banner.
 *
 *  Two shapes:
 *    `ticketImage(media)`  — one specific movie or show (detail pages)
 *    `bannerImage()`       — the site-wide default (home and every other page)
 *
 *  Consumed by the `opengraph-image.js` files under `src/app`.
 *
 *  NOTE: the renderer (satori) supports only a subset of CSS. Everything is
 *  flexbox, nothing is absolutely positioned, and every element with more than
 *  one child needs an explicit `display: flex`. Keep it that way when editing.
 * ============================================================================
 */

/** The size every social network expects (1.91:1). */
export const OG_SIZE = { width: 1200, height: 630 };

const COLORS = site.theme.colors.dark;

/**
 * A stable, ticket-looking reference for a title, e.g. "#M000550" for a film
 * and "#T001399" for a show. Derived from the TMDB id, so the same title always
 * gets the same number.
 */
function serialFor(media) {
  const prefix = media.mediaType === 'tv' ? 'T' : 'M';
  return `#${prefix}${String(media.id).padStart(6, '0')}`;
}

/** "Movie · 2026 · 2h 25m" as separate pills. */
function metaParts(media) {
  const isTv = media.mediaType === 'tv';
  const seasons = media.numberOfSeasons;

  return [
    isTv ? 'TV Show' : 'Movie',
    year(media.releaseDate),
    isTv && seasons ? `${seasons} season${seasons === 1 ? '' : 's'}` : formatRuntime(media.runtime),
  ].filter(Boolean);
}

/** Where the link points, minus the scheme — shown next to the call to action. */
function siteHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL).host;
  } catch {
    return site.brand.name;
  }
}

function Pill({ children }) {
  return (
    <div
      style={{
        display: 'flex',
        padding: '8px 18px',
        borderRadius: '999px',
        border: `2px solid ${COLORS.line}`,
        color: COLORS.text,
        fontSize: '21px',
      }}
    >
      {children}
    </div>
  );
}

function Ticket({ media }) {
  // Pinned rather than left to the default: social cards are rendered once and
  // cached by the crawler, so they are worth the extra bytes. The grid default
  // (`w342`) would look soft here at the size the ticket draws.
  const poster = posterUrl(media.posterPath, 'w500');
  const rating = formatRating(media.voteAverage);
  const serial = serialFor(media);
  const meta = metaParts(media);
  const genres = (media.genres ?? [])
    .slice(0, 3)
    .map((genre) => genre.name)
    .join('  ·  ');
  const overview = truncate(media.overview, 165);

  // Long titles need a smaller size to stay on one or two lines.
  const titleSize = media.title.length > 46 ? 44 : media.title.length > 28 ? 52 : 62;

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        padding: '36px',
        background: COLORS.bg,
      }}
    >
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          borderRadius: '30px',
          border: `2px solid ${COLORS.line}`,
          background: COLORS.card,
          overflow: 'hidden',
        }}
      >
        {/* ---------------- poster ---------------- */}
        <div style={{ display: 'flex', width: '348px', height: '100%', background: COLORS.surface }}>
          {poster ? (
            <img
              src={poster}
              alt=""
              width={348}
              height={558}
              style={{ width: '348px', height: '558px', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                color: COLORS.muted,
                fontSize: '26px',
                textAlign: 'center',
              }}
            >
              {media.title}
            </div>
          )}
        </div>

        {/* ---------------- details ---------------- */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 1,
            padding: '46px 40px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div
                style={{
                  display: 'flex',
                  width: '26px',
                  height: '26px',
                  borderRadius: '9px',
                  background: COLORS.accent,
                }}
              />
              <div style={{ display: 'flex', fontSize: '20px', letterSpacing: '5px', color: COLORS.muted }}>
                {site.brand.name.toUpperCase()}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                fontSize: `${titleSize}px`,
                fontWeight: 700,
                lineHeight: 1.12,
                color: COLORS.text,
              }}
            >
              {media.title}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
              {meta.map((part) => (
                <Pill key={part}>{part}</Pill>
              ))}
            </div>

            {genres && (
              <div style={{ display: 'flex', marginTop: '18px', fontSize: '21px', color: COLORS.muted }}>
                {genres}
              </div>
            )}

            {overview && (
              <div
                style={{
                  display: 'flex',
                  marginTop: '16px',
                  fontSize: '21px',
                  lineHeight: 1.45,
                  color: COLORS.muted,
                }}
              >
                {overview}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div
                style={{
                  display: 'flex',
                  padding: '11px 26px',
                  borderRadius: '999px',
                  background: COLORS.accent,
                  color: COLORS.accentText,
                  fontSize: '21px',
                  fontWeight: 600,
                }}
              >
                Watch now
              </div>
              <div style={{ display: 'flex', fontSize: '19px', color: COLORS.muted }}>{siteHost()}</div>
            </div>

            {rating && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: '42px',
                    fontWeight: 700,
                    lineHeight: 1,
                    color: COLORS.text,
                  }}
                >
                  {rating}
                </div>
                <div style={{ display: 'flex', marginTop: '6px', fontSize: '15px', letterSpacing: '2px', color: COLORS.muted }}>
                  TMDB SCORE
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---------------- torn-off stub ---------------- */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '104px',
            height: '100%',
            borderLeft: `2px dashed ${COLORS.line}`,
            background: COLORS.surface,
          }}
        >
          {/* One character per row gives the vertical serial of a real ticket
              without needing a transform, which the renderer does not support. */}
          {serial.split('').map((character, index) => (
            <div
              key={serial.slice(0, index + 1)}
              style={{
                display: 'flex',
                fontSize: '30px',
                fontWeight: 700,
                lineHeight: 1.2,
                color: index === 0 ? COLORS.muted : COLORS.text,
              }}
            >
              {character}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Builds the PNG response for one title. `media` is the object returned by
 * `getMovie` or `getShow`, so the card reads the same fields every other detail
 * component does.
 */
export function ticketImage(media) {
  return new ImageResponse(<Ticket media={media} />, OG_SIZE);
}

/**
 * The site-wide fallback card, used by pages that are not about one title —
 * the home page, browse pages, search. Everything it shows comes from the
 * brand block in `config/site.js`.
 */
function Banner() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: '60px',
        background: COLORS.bg,
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '34px' }}>
        <div
          style={{
            display: 'flex',
            width: '52px',
            height: '52px',
            borderRadius: '16px',
            background: COLORS.accent,
          }}
        />
        <div style={{ display: 'flex', fontSize: '40px', fontWeight: 700, color: COLORS.text }}>
          {site.brand.name}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          maxWidth: '900px',
          fontSize: '62px',
          fontWeight: 700,
          lineHeight: 1.15,
          color: COLORS.text,
        }}
      >
        {site.brand.tagline}
      </div>

      <div
        style={{
          display: 'flex',
          marginTop: '28px',
          maxWidth: '820px',
          fontSize: '24px',
          lineHeight: 1.5,
          color: COLORS.muted,
        }}
      >
        {site.seo.description}
      </div>
    </div>
  );
}

/** Builds the PNG response for the default card. */
export function bannerImage() {
  return new ImageResponse(<Banner />, OG_SIZE);
}
