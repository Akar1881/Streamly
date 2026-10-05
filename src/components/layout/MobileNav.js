'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import site from '@config/site';
import Icon from '@/components/ui/Icon';

/**
 * Bottom tab bar shown on phones, where a sidebar would eat the screen.
 * Mirrors `nav.main` from the config, capped at five items so the row fits.
 */
export default function MobileNav() {
  const pathname = usePathname();
  const items = site.nav.main.slice(0, 5);

  const isActive = (href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95
        backdrop-blur-lg lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const active = isActive(item.href);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors
                  ${active ? 'text-text' : 'text-muted'}`}
              >
                <Icon name={item.icon} size={20} />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
