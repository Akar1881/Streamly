import site from '@config/site';

/**
 * ============================================================================
 *  THEME PLUMBING
 * ============================================================================
 *  Turns the colour objects in `config/site.js` into CSS custom properties.
 *
 *  Flow:  config/site.js  ->  :root CSS variables  ->  Tailwind utilities
 *
 *  `globals.css` maps each variable to a Tailwind colour via `@theme`, so
 *  `bg-card`, `text-muted`, `border-line` etc. all resolve back to the config.
 * ============================================================================
 */

/** camelCase -> kebab-case, so `cardHover` becomes `--card-hover`. */
function toCssVar(name) {
  return `--${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function blockFor(selector, colors) {
  const lines = Object.entries(colors).map(
    ([name, value]) => `  ${toCssVar(name)}: ${value};`,
  );
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/**
 * The full stylesheet injected once in the root layout. Both themes are always
 * present; `data-theme` on <html> decides which one applies.
 */
export function themeCss() {
  const { colors, radius } = site.theme;

  const radii = [
    `  --radius-card: ${radius.card};`,
    `  --radius-button: ${radius.button};`,
    `  --radius-pill: ${radius.pill};`,
  ].join('\n');

  return [
    blockFor(':root, [data-theme="dark"]', colors.dark),
    blockFor('[data-theme="light"]', colors.light),
    `:root {\n${radii}\n}`,
  ].join('\n\n');
}

/**
 * Runs before first paint so the correct theme is on <html> immediately —
 * without this there is a white flash before React hydrates.
 *
 * Deliberately tiny and dependency-free; it is inlined into the document head.
 */
export function themeInitScript() {
  const { defaultMode, allowToggle } = site.theme;

  return `(function(){try{
var stored = ${allowToggle} ? localStorage.getItem('streamly:theme') : null;
var mode = stored || '${defaultMode}';
document.documentElement.setAttribute('data-theme', mode);
document.documentElement.style.colorScheme = mode;
}catch(e){document.documentElement.setAttribute('data-theme','${defaultMode}');}})();`;
}
