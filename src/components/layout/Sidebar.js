'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import site from '@config/site';
import Icon from '@/components/ui/Icon';

/** A link is active on its own page and on any page nested under it. */
function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar({ collapsed, mobileOpen, onCloseMobile }) {
  const pathname = usePathname();
  const { brand, nav } = site;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-surface
        transition-all duration-300
        ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'}
        w-64 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
    >
      {/* ---------------- brand ---------------- */}
      <Link
        href="/"
        onClick={onCloseMobile}
        className="flex h-16 shrink-0 items-center gap-3 px-5 text-text"
      >
        <Image
          src={brand.logo.src}
          alt={brand.logo.alt}
          width={brand.logo.size}
          height={brand.logo.size}
          className="shrink-0"
          priority
        />
        {brand.logo.showWordmark && (
          <span
            className={`truncate text-lg font-semibold tracking-tight transition-opacity duration-200
              ${collapsed ? 'lg:pointer-events-none lg:opacity-0' : 'opacity-100'}`}
          >
            {brand.name}
          </span>
        )}
      </Link>

      {/* ---------------- links ---------------- */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {nav.heading && (
          <p
            className={`mb-2 px-3 text-xs font-medium text-muted transition-opacity duration-200
              ${collapsed ? 'lg:opacity-0' : 'opacity-100'}`}
          >
            {nav.heading}
          </p>
        )}

        <ul className="space-y-1">
          {nav.main.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onCloseMobile}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex items-center gap-3 rounded-[var(--radius-button)] px-3 py-2.5
                    text-sm transition-colors
                    ${
                      active
                        ? 'border border-line bg-card text-text'
                        : 'border border-transparent text-muted hover:bg-card hover:text-text'
                    }`}
                >
                  <Icon name={item.icon} size={18} className="shrink-0" />
                  <span
                    className={`truncate transition-opacity duration-200
                      ${collapsed ? 'lg:pointer-events-none lg:opacity-0' : 'opacity-100'}`}
                  >
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ---------------- tagline ---------------- */}
      {brand.tagline && !collapsed && (
        <p className="hidden shrink-0 px-5 py-4 text-xs leading-relaxed text-muted lg:block">
          {brand.tagline}
        </p>
      )}
    </aside>
  );
}
