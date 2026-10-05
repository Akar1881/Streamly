'use client';

import { useEffect, useState } from 'react';
import { fetchTmdb } from '@/lib/tmdb/browser';
import { normaliseEpisode } from '@/lib/tmdb/normalise';
import { toSlugId } from '@/lib/format';
import Carousel from '@/components/ui/Carousel';
import Dropdown from '@/components/ui/Dropdown';
import EpisodeCard from '@/components/media/EpisodeCard';
import UpcomingEpisodes from './UpcomingEpisodes';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Season switcher plus the strip of episodes for the chosen season.
 *
 * The season list itself comes from the show detail payload (server-rendered);
 * the episode list is fetched on demand as the visitor changes season, so a
 * 20-season show does not download every episode up front.
 *
 * `upcoming` is the server-rendered list of episodes that have not aired yet;
 * the header shows the soonest one and opens the full list.
 */
export default function SeasonSection({ show, upcoming = [], initialSeason }) {
  const [seasonNumber, setSeasonNumber] = useState(
    initialSeason ?? show.seasons?.[0]?.season_number ?? 1,
  );
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);

  const showSlug = toSlugId(show.id, show.title);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchTmdb(`tv/${show.id}/season/${seasonNumber}`)
      .then((data) => {
        if (!cancelled) setSeason(data);
      })
      .catch(() => {
        if (!cancelled) setSeason(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [show.id, seasonNumber]);

  // The proxy returns raw TMDB fields, so normalise to the same shape the
  // server-rendered path produces — otherwise cards lose their thumbnails.
  const episodes = (season?.episodes ?? []).map((episode) =>
    normaliseEpisode(episode, seasonNumber),
  );

  const current = show.seasons.find((item) => item.season_number === seasonNumber);
  const episodeCount = current?.episode_count ?? episodes.length;

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Season {seasonNumber}
          </h2>
          <span className="text-sm text-muted">
            ({episodeCount} {episodeCount === 1 ? 'episode' : 'episodes'})
          </span>
        </div>

        <div className="flex items-center gap-2">
          <UpcomingEpisodes episodes={upcoming} />

          {/* Jumping straight to the current episode is the common case. */}
          <Dropdown
            label={`Season ${seasonNumber}`}
            icon="layers"
            align="right"
            options={show.seasons.map((item) => ({
              value: String(item.season_number),
              label: `Season ${item.season_number}`,
            }))}
            value={String(seasonNumber)}
            onChange={(value) => value && setSeasonNumber(Number(value))}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="w-[240px] shrink-0 sm:w-[280px]">
              <Skeleton className="aspect-video w-full" />
              <Skeleton className="mt-2 h-4 w-2/3 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <Carousel>
          {episodes.map((episode) => (
            <div key={episode.id} className="snap-item w-[240px] shrink-0 sm:w-[280px]">
              <EpisodeCard episode={episode} showId={show.id} showSlug={showSlug} />
            </div>
          ))}
        </Carousel>
      )}
    </section>
  );
}
