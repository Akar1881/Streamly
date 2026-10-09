'use client';

import PlayerMenu, { MenuNote, MenuRow } from '@/components/player/PlayerMenu';

/**
 * ============================================================================
 *  PLAYER — source menu
 * ============================================================================
 *  Which provider the picture is coming from, on the titles where there is
 *  more than one to choose from.
 *
 *  Every name in here is a codename rather than the name of the service behind
 *  it — see the contract at the top of `src/lib/providers/index.js`. This menu
 *  is the one place a viewer ever reads those names, so it is the one place
 *  that rule is visible.
 *
 *  A source that answered "not here" or threw for this title is listed rather
 *  than dropped, greyed out and marked Unavailable. Taking it out would leave a
 *  viewer who remembers three sources looking at a menu of two and wondering
 *  which one they imagined; saying it is unavailable answers the question they
 *  actually have. It is also why the row is disabled rather than merely dimmed:
 *  a provider with nothing for *this* title will have nothing for it a second
 *  later and on every other title it is the same provider, so there is nothing
 *  a click could reach.
 *
 *  The number on the right is the resolution the source was measured at, which
 *  is also the reason the playing one is playing — the site starts the best
 *  stream it can find rather than the first in the config, and a viewer who
 *  wonders why the second name is the one that is ticked can see the answer
 *  without opening anything. Reaching for a different source is still entirely
 *  theirs to do; this menu overrides the choice rather than reporting it.
 * ============================================================================
 */

/**
 * @param {object} props
 * @param {{id: string, label: string}[]} props.providers
 * @param {string} props.providerId     the one currently playing
 * @param {string[]} props.unavailable  ids that came back empty or failed
 * @param {Record<string, {label: string}>} [props.qualities]
 *        what each source measured at, by id — missing where it could not be
 *        measured, which is shown as nothing rather than as a guess
 * @param {(id: string) => void} props.onSelect
 * @param {() => void} props.onClose
 */
export default function ProviderMenu({
  providers,
  providerId,
  unavailable = [],
  qualities = {},
  onSelect,
  onClose,
}) {
  return (
    <PlayerMenu title="Source" onClose={onClose}>
      {providers.map((provider) => {
        const active = provider.id === providerId;
        // The active one is never disabled. It cannot be unavailable — nothing
        // that came back empty is ever chosen — but the row that says what is
        // playing is the one row a viewer must be able to read.
        const dead = !active && unavailable.includes(provider.id);
        const quality = qualities[provider.id]?.label;

        return (
          <MenuRow
            key={provider.id}
            label={provider.label}
            trailing={dead ? 'Unavailable' : quality}
            selected={active}
            disabled={dead}
            onClick={() => onSelect(provider.id)}
          />
        );
      })}

      <MenuNote>
        This started the best picture it could find. If it will not play, or keeps
        stopping, another source often has it.
      </MenuNote>
    </PlayerMenu>
  );
}
