'use client';

import PlayerMenu, { MenuNote, MenuRow } from '@/components/player/PlayerMenu';

/**
 * ============================================================================
 *  PLAYER — audio menu
 * ============================================================================
 *  The audio renditions a stream carries, as reported by whichever engine is
 *  playing: the alternate language tracks of an HLS master, or the ones an
 *  element exposes by itself in Safari.
 *
 *  Switching is the engine's rather than a reload. hls.js swaps the audio
 *  playlist under the same picture, and the element's own tracks are toggled in
 *  place — neither moves the playhead, so nothing here has to re-seek or
 *  restart, and nothing here does.
 *
 *  A note about what is *not* here: there is no automatic entry, because there
 *  is nothing for one to mean. A quality ladder can be left to the engine to
 *  judge; an audio rendition is a language, and "whichever it thinks" is not an
 *  answer anybody wants. The track that plays is the one the stream marks as
 *  its default until the viewer says otherwise.
 * ============================================================================
 */

/**
 * @param {object} props
 * @param {{id: number, label: string}[]} props.tracks
 * @param {number} props.current  the `id` of the rendition playing, or -1
 * @param {(id: number) => void} props.onSelect
 * @param {() => void} props.onClose
 */
export default function AudioMenu({ tracks, current, onSelect, onClose }) {
  return (
    <PlayerMenu title="Audio" onClose={onClose}>
      {tracks.map((track) => (
        <MenuRow
          key={track.id}
          label={track.label}
          selected={track.id === current}
          onClick={() => onSelect(track.id)}
        />
      ))}

      {/* Reachable only when the list is pulled out from under an open menu —
          the bar keeps the button away until there are two renditions to choose
          between, so this is not a state a viewer arrives at by opening it. */}
      {tracks.length < 2 && (
        <MenuNote>
          {tracks.length === 1
            ? 'This stream has one audio track.'
            : 'This stream has no audio tracks to choose from.'}
        </MenuNote>
      )}
    </PlayerMenu>
  );
}
