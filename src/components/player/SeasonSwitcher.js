'use client';

import { useRouter } from 'next/navigation';
import Dropdown from '@/components/ui/Dropdown';

/**
 * Season picker for the watch page.
 *
 * The detail page's season dropdown changes what is *shown*; this one changes
 * where the viewer *is*, so picking a season is a navigation. It goes to the
 * first episode of the chosen season rather than trying to hold the current
 * episode number: episode 5 of one season is a different point in the story
 * from episode 5 of the next, and a season with fewer episodes than the one
 * being watched would have no such episode at all.
 *
 * Seasons with no episodes are left out. The detail page can list them, because
 * an empty season is still worth reading about, but there is nothing to play
 * here and `/watch/tv/…/<empty season>/1` would land on a 404.
 */
export default function SeasonSwitcher({ seasons = [], slug, season }) {
  const router = useRouter();

  const options = seasons
    .filter((item) => (item.episode_count ?? 0) > 0)
    .map((item) => ({
      value: String(item.season_number),
      label: `Season ${item.season_number}`,
    }));

  // One season is not a choice, so the control is not shown at all.
  if (options.length < 2) return null;

  return (
    <Dropdown
      label={`Season ${season}`}
      icon="layers"
      align="right"
      options={options}
      value={String(season)}
      onChange={(value) => {
        // `null` is the dropdown's own clear button, which has no meaning for a
        // season — there is no "all seasons" to fall back to.
        if (!value || Number(value) === Number(season)) return;
        router.push(`/watch/tv/${slug}/${value}/1`);
      }}
    />
  );
}
