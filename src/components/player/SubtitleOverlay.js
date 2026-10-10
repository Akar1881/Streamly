'use client';

import { useEffect, useState } from 'react';
import { cueAt } from '@/lib/player/cues';
import { cueStyle } from '@/lib/player/settings';

/**
 * ============================================================================
 *  PLAYER — subtitle overlay
 * ============================================================================
 *  Paints the cue that belongs to the current moment.
 *
 *  This is DOM rather than a `<track>` element, and the reason is the
 *  customization panel. A native track can only be styled through `::cue`,
 *  which has no equivalent for background blur, a raised edge or a vertical
 *  position — and Safari ignores much of what it does support. Since the panel
 *  is the requirement, the cues are parsed into objects and rendered here.
 *
 *  The cost is real and worth stating: **subtitles do not appear inside the
 *  browser's Picture-in-Picture window**, because that window composites the
 *  native video element and nothing else. A second `<track>` set to
 *  `mode="hidden"` does not help — hidden means the cues are not rendered
 *  anywhere, by definition. This is a known limitation, not a bug.
 *
 *  Its own timing is deliberate. `timeupdate` fires about four times a second,
 *  which is fine for a clock and visibly late for a subtitle, so while the video
 *  is playing this advances on animation frames and stops the loop the moment it
 *  pauses. The lookup is a binary search and the resulting state is only set when
 *  the cue actually changes, so a feature-length track costs a handful of
 *  renders rather than thousands.
 * ============================================================================
 */

/**
 * @param {object} props
 * @param {HTMLVideoElement|null} props.video   the element to follow
 * @param {object[]} props.cues                 parsed, sorted by start time
 * @param {number}   props.delay                subtitle delay in seconds
 * @param {object}   props.settings             appearance, from `settings.js`
 */
export default function SubtitleOverlay({ video, cues, delay = 0, settings }) {
  const [cue, setCue] = useState(null);

  useEffect(() => {
    if (!video || !Array.isArray(cues) || !cues.length) {
      setCue(null);
      return undefined;
    }

    const read = () => {
      const next = cueAt(cues, video.currentTime - delay);
      // `cueAt` hands back the same object for the same cue, so identity is a
      // valid "did this change" test and no render happens between cues.
      setCue((previous) => (previous === next ? previous : next));
    };

    let frame = 0;
    const loop = () => {
      read();
      frame = requestAnimationFrame(loop);
    };

    const start = () => {
      if (frame) return;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      read(); // one last look, so the cue is right while paused
    };

    // The frame loop covers smooth playback; the events cover everything a loop
    // is not needed for — a seek, a pause, a newly loaded track, a rate change.
    video.addEventListener('play', start);
    video.addEventListener('playing', start);
    video.addEventListener('pause', stop);
    video.addEventListener('ended', stop);
    video.addEventListener('seeked', read);
    video.addEventListener('seeking', read);
    video.addEventListener('timeupdate', read);
    video.addEventListener('ratechange', read);
    video.addEventListener('loadedmetadata', read);

    if (!video.paused) start();
    read();

    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener('play', start);
      video.removeEventListener('playing', start);
      video.removeEventListener('pause', stop);
      video.removeEventListener('ended', stop);
      video.removeEventListener('seeked', read);
      video.removeEventListener('seeking', read);
      video.removeEventListener('timeupdate', read);
      video.removeEventListener('ratechange', read);
      video.removeEventListener('loadedmetadata', read);
    };
  }, [video, cues, delay]);

  return (
    // The custom properties live here, on a wrapper that keeps its identity
    // across renders, so dragging a slider in the settings panel restyles the
    // cue rather than re-rendering this tree.
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      style={cueStyle(settings)}
    >
      <div className="player-cue-layer">
        {cue && (
          <span dir="auto" className="player-cue">
            {cue.text}
          </span>
        )}
      </div>
    </div>
  );
}
