'use client';

import PlayerMenu, { MenuNote, MenuRow } from '@/components/player/PlayerMenu';

/**
 * ============================================================================
 *  PLAYER — quality menu
 * ============================================================================
 *  The rungs of the stream's ladder, as reported by whichever engine is playing.
 *
 *  The list is whatever the manifest declared, so it is empty for anything that
 *  is not HLS and for HLS playing natively in Safari. Rather than show an empty
 *  menu, that case says so — a viewer who cannot find a quality setting should be
 *  told there is nothing to choose, not left wondering whether the button is
 *  broken.
 *
 *  Automatic is the default and is what the engine is left on unless the viewer
 *  picks a rung, at which point it stays pinned there. That is the conventional
 *  behaviour and the one that surprises nobody.
 * ============================================================================
 */

/**
 * @param {object} props
 * @param {{index: number, label: string}[]} props.levels
 * @param {boolean} props.auto       true while the engine is choosing
 * @param {number} props.current     the rung actually playing
 * @param {(index: number|null) => void} props.onSelect
 * @param {string} props.engine      'hls' | 'native' | 'direct', for the note
 * @param {() => void} props.onClose
 */
export default function QualityMenu({ levels, auto, current, onSelect, engine, onClose }) {
  const playing = levels.find((level) => level.index === current);

  return (
    <PlayerMenu title="Quality" onClose={onClose}>
      <MenuRow
        label="Auto"
        trailing={auto && playing ? playing.label : undefined}
        selected={auto}
        onClick={() => onSelect(null)}
      />

      {levels.map((level) => (
        <MenuRow
          key={level.index}
          label={level.label}
          selected={!auto && level.index === current}
          onClick={() => onSelect(level.index)}
        />
      ))}

      {levels.length === 0 && (
        <MenuNote>
          {engine === 'native'
            ? 'This browser plays the stream itself, so the quality is automatic.'
            : 'This source has only one quality.'}
        </MenuNote>
      )}
    </PlayerMenu>
  );
}
