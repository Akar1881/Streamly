'use client';

import PlayerMenu from '@/components/player/PlayerMenu';
import Slider from '@/components/player/Slider';
import { cueStyle, options } from '@/lib/player/settings';

/**
 * ============================================================================
 *  PLAYER — subtitle appearance
 * ============================================================================
 *  Every control in the customization panel, over a live sample.
 *
 *  The sample is not an approximation of the cue: it is the same `.player-cue`
 *  element the overlay paints, with the same custom properties on its wrapper.
 *  That is deliberate — a preview that is styled separately is a preview that
 *  drifts, and the whole point of showing one is that what you see is what the
 *  film will look like.
 *
 *  There is no state here. The panel is handed the settings and a way to change
 *  them, which is what lets the player persist them, and lets Reset to Default
 *  mean the same thing in both places.
 * ============================================================================
 */

/** One labelled group of controls. */
function Field({ label, children, hint }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-white/60">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-white/35">{hint}</p>}
    </div>
  );
}

/** A row of mutually exclusive pills — sizes, edge styles, alignments. */
function Segmented({ name, label, value, onChange, wrap = false }) {
  return (
    <div className={`flex gap-1 ${wrap ? 'flex-wrap' : ''}`} role="group" aria-label={label ?? name}>
      {options(name).map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={`h-8 rounded-[var(--radius-button)] border px-3 text-xs transition-colors
              ${
                selected
                  ? 'border-transparent bg-white text-black'
                  : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/15 hover:text-white'
              }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Round colour swatches, for the text colour. */
function Swatches({ value, onChange }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Text colour">
      {options('color').map((option) => {
        const selected = option.value.toLowerCase() === String(value).toLowerCase();

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-label={option.label}
            aria-pressed={selected}
            title={option.label}
            className={`size-7 rounded-full border transition-transform
              ${selected ? 'border-white ring-2 ring-white/70' : 'border-white/25 hover:scale-110'}`}
            style={{ background: option.value }}
          />
        );
      })}
    </div>
  );
}

/**
 * A labelled slider with its current reading.
 *
 * The reading is on the label line rather than under the bar so the value and
 * what it belongs to stay together, which matters most for the two sliders whose
 * numbers are meaningless on their own — blur in pixels and position as a
 * percentage.
 */
function RangeField({ label, value, min, max, step, onChange, display, caption }) {
  return (
    <Field label={label}>
      <div className="mb-1 flex items-center justify-between gap-2">
        {caption ? (
          <span className="text-[11px] text-white/35">{caption}</span>
        ) : (
          <span />
        )}
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-white/80">
          {display(value)}
        </span>
      </div>

      <Slider
        label={label}
        value={value}
        max={max}
        step={step}
        onChange={(next) => onChange(Math.min(Math.max(next, min), max))}
        format={display}
        className="h-4"
        fillClassName="bg-white"
      />
    </Field>
  );
}

/**
 * @param {object} props
 * @param {object} props.settings
 * @param {(patch: object) => void} props.onChange  a partial settings object
 * @param {() => void} props.onReset
 * @param {() => void} props.onBack
 * @param {() => void} props.onClose
 */
export default function SubtitleSettingsPanel({ settings, onChange, onReset, onBack, onClose }) {
  return (
    <PlayerMenu title="Customize" wide onBack={onBack} onClose={onClose}>
      <div className="space-y-4 px-3 py-3">
        {/* The live sample. Same class, same custom properties, as the overlay. */}
        <div
          className="rounded-[var(--radius-button)] border border-white/10 bg-gradient-to-b
            from-black/30 to-black/70 px-3 py-7"
          style={cueStyle(settings)}
        >
          <div style={{ textAlign: 'var(--cue-align)' }}>
            <span className="player-cue">Sample subtitle text</span>
          </div>
        </div>

        <Field label="Font">
          <Segmented
            name="font"
            label="Font"
            value={settings.font}
            onChange={(font) => onChange({ font })}
          />
        </Field>

        <Field label="Size">
          <Segmented
            name="size"
            label="Subtitle size"
            value={settings.size}
            onChange={(size) => onChange({ size })}
          />
        </Field>

        <Field label="Text Color">
          <Swatches value={settings.color} onChange={(color) => onChange({ color })} />
        </Field>

        <RangeField
          label="Text Opacity"
          value={settings.opacity}
          min={0.2}
          max={1}
          step={0.05}
          display={(value) => `${Math.round(value * 100)}%`}
          onChange={(opacity) => onChange({ opacity })}
        />

        <Field label="Edge Style">
          <Segmented
            name="edge"
            label="Edge style"
            value={settings.edge}
            onChange={(edge) => onChange({ edge })}
            wrap
          />
        </Field>

        <Field label="Background">
          <Segmented
            name="background"
            label="Background"
            value={settings.background}
            onChange={(background) => onChange({ background })}
          />
        </Field>

        <RangeField
          label="Background Blur"
          value={settings.blur}
          min={0}
          max={20}
          step={1}
          display={(value) => `${Math.round(value)}px`}
          onChange={(blur) => onChange({ blur })}
        />

        <RangeField
          label="Vertical Position"
          value={settings.position}
          min={0}
          max={60}
          step={1}
          caption="Lower / Higher"
          display={(value) => `${Math.round(value)}%`}
          onChange={(position) => onChange({ position })}
        />

        <Field label="Horizontal Alignment">
          <Segmented
            name="align"
            label="Horizontal alignment"
            value={settings.align}
            onChange={(align) => onChange({ align })}
          />
        </Field>

        <button
          type="button"
          onClick={onReset}
          className="w-full rounded-[var(--radius-button)] border border-white/15 bg-white/5 py-2.5
            text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white"
        >
          Reset to Default
        </button>
      </div>
    </PlayerMenu>
  );
}
