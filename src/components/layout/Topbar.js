'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import site from '@config/site';
import Icon from '@/components/ui/Icon';
import SearchBar from './SearchBar';
import ThemeToggle from './ThemeToggle';

/**
 * Builds the crumb trail from the URL alone, so pages do not have to pass
 * anything up. `/tv/68006-taken` becomes  TV Shows › Taken.
 */
function crumbsFor(pathname) {
  const [section, slug] = pathname.split('/').filter(Boolean);

  const SECTIONS = {
    movies: { label: 'Movies', href: '/movies', icon: 'clapperboard' },
    tv: { label: 'TV Shows', href: '/tv', icon: 'tv-minimal' },
    person: { label: 'People', href: '/search', icon: 'users' },
    'my-list': { label: 'My List', href: '/my-list', icon: 'bookmark' },
    search: { label: 'Search', href: '/search', icon: 'search' },
  };

  const root = SECTIONS[section];
  if (!root) return [];
  if (!slug) return [root];

  // "68006-taken" -> "Taken"
  const title = slug
    .replace(/^\d+-?/, '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return title ? [root, { label: title }] : [root];
}

export default function Topbar({ collapsed, onToggleSidebar, onOpenMobileNav }) {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname);

  return (
    <header
      className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line
        bg-bg/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8"
    >
      {/* open the drawer on mobile */}
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted
          transition-colors hover:bg-card hover:text-text lg:hidden"
      >
        <Icon name="menu" size={20} />
      </button>

      {/* collapse the sidebar on desktop */}
      {site.nav.collapsible && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="hidden size-9 shrink-0 place-items-center rounded-full text-muted
            transition-colors hover:bg-card hover:text-text lg:grid"
        >
          <Icon name="panel-left" size={18} />
        </button>
      )}

      {/* breadcrumbs — hidden on small screens so the search box gets the room */}
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 md:flex">
          {crumbs.map((crumb, index) => (
            <span key={crumb.label} className="flex min-w-0 items-center gap-2">
              {index > 0 && <Icon name="chevron-right" size={14} className="shrink-0 text-muted" />}

              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="flex shrink-0 items-center gap-1.5 text-sm text-muted
                    transition-colors hover:text-text"
                >
                  {crumb.icon && <Icon name={crumb.icon} size={15} />}
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-sm font-medium text-text">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* search sits right-of-centre, as in the reference layout */}
      <div className="ml-auto flex flex-1 justify-end">
        {site.features.search && <SearchBar />}
      </div>

      <ThemeToggle />
    </header>
  );
}
