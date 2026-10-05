import { Outfit } from 'next/font/google';
import site from '@config/site';
import { themeCss, themeInitScript } from '@/lib/theme';
import AppShell from '@/components/layout/AppShell';
import './globals.css';

/**
 * `next/font` self-hosts the family named in `config/site.js`, so there is no
 * render-blocking request to Google and no layout shift.
 *
 * Next.js requires every argument here to be a literal it can read at build
 * time, so these two values cannot come from the config object. To change the
 * font, edit the import and the values below — then update
 * `theme.font` in config/site.js to match, since the CSS variable name is what
 * the rest of the styles reference.
 */
const brandFont = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-brand',
  display: 'swap',
});

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: site.seo.defaultTitle,
    template: site.seo.titleTemplate,
  },
  description: site.seo.description,
  keywords: site.seo.keywords,
  applicationName: site.brand.name,
  icons: { icon: site.brand.favicon },
  robots: site.seo.allowIndexing ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    type: 'website',
    siteName: site.brand.name,
    title: site.seo.defaultTitle,
    description: site.seo.description,
    images: site.seo.ogImage ? [site.seo.ogImage] : undefined,
  },
  twitter: {
    card: 'summary_large_image',
    title: site.seo.defaultTitle,
    description: site.seo.description,
    creator: site.seo.twitterHandle || undefined,
    images: site.seo.ogImage ? [site.seo.ogImage] : undefined,
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: site.theme.colors.dark.bg,
};

export default function RootLayout({ children }) {
  // `data-scroll-behavior` tells Next.js that globals.css sets
  // `scroll-behavior: smooth`, so it can suspend that during route transitions
  // instead of animating the scroll position on every navigation.
  return (
    <html
      lang={site.tmdb.language.split('-')[0]}
      data-theme={site.theme.defaultMode}
      data-scroll-behavior="smooth"
      className={brandFont.variable}
      suppressHydrationWarning
    >
      <head>
        {/* Colour tokens generated from config/site.js */}
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        {/* Applies the saved theme before first paint, preventing a flash */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="bg-bg text-text antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
