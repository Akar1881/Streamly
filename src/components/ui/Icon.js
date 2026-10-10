'use client';

import {
  AlertCircle,
  ArrowUpDown,
  AtSign,
  AudioLines,
  AudioWaveform,
  Bookmark,
  BookmarkCheck,
  Building2,
  Calendar,
  Captions,
  CaptionsOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Cloud,
  Factory,
  Film,
  Gauge,
  Globe,
  House,
  Image as ImageIcon,
  Info,
  Languages,
  Layers,
  Link2,
  LoaderCircle,
  Maximize,
  Maximize2,
  Menu,
  Minus,
  Minimize,
  Moon,
  PanelLeft,
  Pause,
  PictureInPicture,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  Settings2,
  Share2,
  SkipForward,
  SlidersHorizontal,
  Star,
  Sun,
  Tag,
  TvMinimal,
  Users,
  Video,
  Volume1,
  Volume2,
  VolumeX,
  X,
  Zap,
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
  'audio-lines': AudioLines,
  'audio-waveform': AudioWaveform,
  bookmark: Bookmark,
  'bookmark-check': BookmarkCheck,
  building: Building2,
  calendar: Calendar,
  captions: Captions,
  'captions-off': CaptionsOff,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  clapperboard: Clapperboard,
  clock: Clock,
  cloud: Cloud,
  factory: Factory,
  film: Film,
  gauge: Gauge,
  globe: Globe,
  house: House,
  image: ImageIcon,
  info: Info,
  languages: Languages,
  layers: Layers,
  link: Link2,
  loader: LoaderCircle,
  maximize: Maximize,
  'maximize-2': Maximize2,
  menu: Menu,
  minimize: Minimize,
  minus: Minus,
  moon: Moon,
  'panel-left': PanelLeft,
  pause: Pause,
  'picture-in-picture': PictureInPicture,
  play: Play,
  plus: Plus,
  'rotate-ccw': RotateCcw,
  'rotate-cw': RotateCw,
  search: Search,
  send: Send,
  'settings-2': Settings2,
  share: Share2,
  'skip-forward': SkipForward,
  sliders: SlidersHorizontal,
  star: Star,
  sun: Sun,
  tag: Tag,
  'tv-minimal': TvMinimal,
  users: Users,
  video: Video,
  'volume-1': Volume1,
  'volume-2': Volume2,
  'volume-x': VolumeX,
  x: X,
  zap: Zap,
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
