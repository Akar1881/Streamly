'use client';

import {
  AlertCircle,
  ArrowUpDown,
  AtSign,
  Bookmark,
  BookmarkCheck,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Film,
  Globe,
  House,
  Image as ImageIcon,
  Info,
  Layers,
  Link2,
  LoaderCircle,
  Menu,
  PanelLeft,
  Play,
  Search,
  Send,
  Share2,
  SlidersHorizontal,
  Star,
  Sun,
  Moon,
  Tag,
  TvMinimal,
  Users,
  Video,
  X,
} from 'lucide-react';

/**
 * Icons are referenced by name from `config/site.js` (e.g. `icon: 'house'`).
 *
 * This registry is explicit rather than a dynamic namespace import so that the
 * bundler only ships the icons actually used. To make a new icon available to
 * the config, import it above and add one line here.
 *
 * Note: lucide no longer ships brand logos (Instagram, X/Twitter, etc.), so use
 * a generic icon such as `at-sign`, `link` or `send` for social links.
 */
const REGISTRY = {
  'alert-circle': AlertCircle,
  'arrow-up-down': ArrowUpDown,
  'at-sign': AtSign,
  bookmark: Bookmark,
  'bookmark-check': BookmarkCheck,
  building: Building2,
  calendar: Calendar,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  clapperboard: Clapperboard,
  clock: Clock,
  film: Film,
  globe: Globe,
  house: House,
  image: ImageIcon,
  info: Info,
  layers: Layers,
  link: Link2,
  loader: LoaderCircle,
  menu: Menu,
  moon: Moon,
  'panel-left': PanelLeft,
  play: Play,
  search: Search,
  send: Send,
  share: Share2,
  sliders: SlidersHorizontal,
  star: Star,
  sun: Sun,
  tag: Tag,
  'tv-minimal': TvMinimal,
  users: Users,
  video: Video,
  x: X,
};

/**
 * @param {object} props
 * @param {string} props.name  a key from REGISTRY above
 * @param {number} [props.size]
 */
export default function Icon({ name, size = 18, className = '', ...rest }) {
  const Glyph = REGISTRY[name];

  if (!Glyph) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Icon] Unknown icon "${name}". Add it to src/components/ui/Icon.js.`);
    }
    return null;
  }

  return <Glyph size={size} className={className} strokeWidth={1.75} aria-hidden="true" {...rest} />;
}

export { REGISTRY as ICON_NAMES };
