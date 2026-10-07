/**
 * ============================================================================
 *  PLAYER — subtitle appearance settings
 * ============================================================================
 *  The defaults live in `config/site.js` (`player.subtitleStyle`), the stored
 *  copy lives in `src/lib/storage.js`, and this file is the only thing that knows
 *  about both.
 *
 *  It exists because the two can disagree. That file was written by a previous
 *  version of the site: it may be missing a key that has since been added, or
 *  hold a size that has since been renamed. Rather than trust it, everything read
 *  back is passed through `normalize` — every value is checked against the
 *  options in the config and replaced with the default when it is not one of
 *  them. A stored `size: 'enormous'` renders as the default size instead of
 *  producing an empty subtitle with no explanation.
 * ============================================================================
 */

import site from '@config/site';
import { getPlayerSettings, setPlayerSettings, clearPlayerSettings } from '@/lib/storage';

/** The config blocks this module reads. */
const CONFIG = site.player.subtitleStyle;

/**
 * Which option list validates which setting.
 *
 * The config names its lists in the plural (`fonts`, `sizes`, `edges`) because
 * each is read as a collection, while a setting is a single value. Everything
 * here is addressed by the *setting* name — `options('size')` rather than
 * `options('sizes')` — so there is one name per control rather than two that
 * have to be kept in step. They were not, once: `normalize` looked up the
 * singular name in a plural-keyed map, silently discarded every list-valued
 * choice, and reset the whole panel to its defaults on save.
 */
const LISTS = {
  font: 'fonts',
  size: 'sizes',
  color: 'colors',
  edge: 'edges',
  background: 'backgrounds',
  align: 'aligns',
};

/** A fresh copy of the configured defaults — never the live config object. */
export function defaultSettings() {
  return { ...CONFIG.defaults };
}

/** The option list for a setting: `'size'`, `'edge'`, `'color'`, … */
export function options(name) {
  return CONFIG.options[LISTS[name]] ?? [];
}

/** The option object with a matching value, or undefined. */
export function findOption(name, value) {
  return options(name).find((option) => option.value === value);
}

/** The label to print for the current value, falling back to the default's. */
export function optionLabel(name, value) {
  const chosen = findOption(name, value) ?? findOption(name, CONFIG.defaults[name]);
  return chosen?.label ?? String(value ?? '');
}

/**
 * Forces a settings object into a shape the player can render.
 *
 * Numbers are clamped to their sliders' ranges rather than merely checked, so a
 * hand-edited localStorage entry cannot push the subtitle off the top of the
 * frame or make the plate blur the whole picture.
 */
export function normalize(raw) {
  const defaults = defaultSettings();
  const input = raw && typeof raw === 'object' ? raw : {};
  const next = { ...defaults };

  // Anything chosen from a list — a bad value falls back to the default.
  for (const name of Object.keys(LISTS)) {
    if (findOption(name, input[name])) next[name] = input[name];
  }

  // A colour is free-form (it may be a CSS token), so it is only checked for
  // being a string that is not blank.
  if (typeof input.color === 'string' && input.color.trim()) next.color = input.color.trim();

  next.opacity = clampNumber(input.opacity, 0.2, 1, defaults.opacity);
  next.blur = clampNumber(input.blur, 0, 20, defaults.blur);
  next.position = clampNumber(input.position, 0, 60, defaults.position);

  return next;
}

/** A finite number inside `[min, max]`, or `fallback` for anything else. */
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

/** What the viewer has saved, reconciled against the current defaults. */
export function loadSettings() {
  return normalize(getPlayerSettings());
}

export function saveSettings(settings) {
  setPlayerSettings(normalize(settings));
}

export function resetSettings() {
  clearPlayerSettings();
  return defaultSettings();
}

/* -------------------------------------------------------------------------- */
/*  THE OVERLAY'S STYLE                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The edge treatments, as the two CSS values that express them.
 *
 * `stroke` draws a halo around each glyph and `shadow` sits behind the text.
 * Outline needs a stroke and almost no shadow; drop shadow is the reverse;
 * raised is two opposing shadows, which is what reads as a bevel. Only Outline
 * needs `paint-order: stroke fill` in the stylesheet to keep the stroke from
 * eating the letterforms — see `SubtitleOverlay.js`.
 */
const EDGES = {
  none: { stroke: '0em', shadow: 'none' },
  shadow: {
    stroke: '0em',
    shadow: '0 2px 5px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.9)',
  },
  outline: {
    stroke: '0.12em',
    shadow: '0 2px 4px rgba(0, 0, 0, 0.5)',
  },
  raised: {
    stroke: '0em',
    shadow:
      '-1px -1px 1px rgba(0, 0, 0, 0.45), 1px 1px 2px rgba(0, 0, 0, 0.9), 0 2px 5px rgba(0, 0, 0, 0.7)',
  },
};

/**
 * Turns settings into the CSS custom properties the overlay is styled by.
 *
 * Returned as custom properties rather than as inline styles on the cue itself
 * so that dragging a slider re-renders the settings panel and nothing else. The
 * properties land on the overlay's wrapper, which keeps its identity across
 * renders, so a change is a style recalculation rather than a re-render of the
 * cue tree.
 *
 * @returns {import('react').CSSProperties}
 */
export function cueStyle(settings) {
  const size = findOption('size', settings.size) ?? findOption('size', CONFIG.defaults.size);
  const font = findOption('font', settings.font) ?? findOption('font', CONFIG.defaults.font);
  const background =
    findOption('background', settings.background) ??
    findOption('background', CONFIG.defaults.background);
  const edge = EDGES[settings.edge] ?? EDGES[CONFIG.defaults.edge];

  return {
    '--cue-font': font?.stack ?? 'system-ui, sans-serif',
    '--cue-scale': String(size?.scale ?? 1),
    '--cue-color': settings.color,
    '--cue-opacity': String(settings.opacity),
    '--cue-bg': background?.color ?? 'transparent',
    '--cue-blur': `${settings.blur}px`,
    '--cue-bottom': `${settings.position}%`,
    '--cue-align': settings.align,
    '--cue-stroke': edge.stroke,
    '--cue-shadow': edge.shadow,
  };
}
