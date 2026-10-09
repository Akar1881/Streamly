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
 * ============================================================================
 */

/**
 * @param {object} props
 * @param {{id: string, label: string}[]} props.providers
 * @param {string} props.providerId     the one currently playing
 * @param {string[]} props.unavailable  ids that came back empty or failed
 * @param {(id: string) => void} props.onSelect
 * @param {() => void} props.onClose
 */
export default function ProviderMenu({ providers, providerId, unavailable = [], onSelect, onClose }) {
  return (
    <PlayerMenu title="Source" onClose={onClose}>
      {providers.map((provider) => {
        const active = provider.id === providerId;
        // The active one is never disabled, even when it is the source that
        // just failed — the player's Retry button and this row are the same
        // request, and greying out the only row that can repeat it would leave
        // a viewer with no way back from a blip.
        const dead = !active && unavailable.includes(provider.id);

        return (
          <MenuRow
            key={provider.id}
            label={provider.label}
            trailing={dead ? 'Unavailable' : undefined}
            selected={active}
            disabled={dead}
            onClick={() => onSelect(provider.id)}
          />
        );
      })}

      <MenuNote>
        If a title will not start, or keeps stopping, another source often has it.
      </MenuNote>
    </PlayerMenu>
  );
}
