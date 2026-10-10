'use client';

/**
 * ============================================================================
 *  RANGE SLIDER
 * ============================================================================
 *  A two-thumb slider — one thumb per end of the range — behind the Year,
 *  Rating and Runtime filters.
 *
 *  A native range input only has one thumb, so this stacks two of them on the
 *  same track. The inputs themselves are transparent and ignore the pointer;
 *  only their thumbs are grabbable, which is what lets both be dragged even
 *  when they sit on top of one another.
 *
 *  Values are strings ('' means "this end is not set") because that is how they
 *  travel in the URL.
 * ============================================================================
 */
export default function RangeSlider({
  min,
  max,
  step = 1,
  from,
  to,
  onChange,
  marks = [],
}) {
  const start = from === '' ? min : Number(from);
  const end = to === '' ? max : Number(to);

  const span = max - min || 1;
  const percent = (value) => ((value - min) / span) * 100;
  const left = Math.min(percent(start), percent(end));
  const right = Math.max(percent(start), percent(end));

  /** Moving one thumb past the other drags the other along. */
  function moveStart(raw) {
    const value = Math.min(Number(raw), end);
    onChange(value <= min ? '' : String(value), to);
  }

  function moveEnd(raw) {
    const value = Math.max(Number(raw), start);
    onChange(from, value >= max ? '' : String(value));
  }

  const thumb = `[&::-webkit-slider-thumb]:pointer-events-auto
    [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none
    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2
    [&::-webkit-slider-thumb]:border-bg [&::-webkit-slider-thumb]:bg-text
    [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:pointer-events-auto
    [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full
    [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-bg
    [&::-moz-range-thumb]:bg-text`;

  const input = `pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full
    -translate-y-1/2 appearance-none bg-transparent outline-none
    [&::-webkit-slider-runnable-track]:bg-transparent
    [&::-moz-range-track]:bg-transparent ${thumb}`;

  return (
    <div className="pt-1">
      <div className="relative h-5">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-line" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-text"
          style={{ left: `${left}%`, right: `${100 - right}%` }}
        />

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={start}
          onChange={(event) => moveStart(event.target.value)}
          aria-label="Minimum"
          style={{ zIndex: start > (min + max) / 2 ? 3 : 2 }}
          className={input}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={end}
          onChange={(event) => moveEnd(event.target.value)}
          aria-label="Maximum"
          style={{ zIndex: 3 }}
          className={input}
        />
      </div>

      {marks.length > 0 && (
        <div className="relative mt-2 h-4">
          {marks.map((mark) => (
            <span
              key={mark}
              className="absolute -translate-x-1/2 text-xs text-muted"
              style={{ left: `${percent(mark)}%` }}
            >
              {mark}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
