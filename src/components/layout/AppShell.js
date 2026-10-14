'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import Footer from './Footer';
import MobileNav from './MobileNav';
import DesktopUpdatePrompt from '@/components/media/DesktopUpdatePrompt';

/**
 * The frame every page sits inside.
 *
 * Layout:
 *   - desktop : fixed sidebar on the left, content fills the rest
 *   - tablet  : sidebar collapses to an icon rail
 *   - mobile  : sidebar is hidden and replaced by a bottom tab bar
 *
 * Only the collapse state lives here; everything else is in the children.
 */
export default function AppShell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Dim the page behind the mobile drawer */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <div
        className={`flex min-h-dvh flex-col transition-[padding] duration-300 ${
          collapsed ? 'lg:pl-[76px]' : 'lg:pl-64'
        }`}
      >
        <Topbar
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed((value) => !value)}
          onOpenMobileNav={() => setMobileOpen(true)}
        />

        {/* pb-20 leaves room for the mobile tab bar */}
        <main className="flex-1 pb-20 lg:pb-0">{children}</main>

        <Footer />
      </div>

      <MobileNav />
      <DesktopUpdatePrompt />
    </div>
  );
}
