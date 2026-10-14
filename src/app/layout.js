import { Outfit } from 'next/font/google';
import localFont from 'next/font/local';
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

/**
 * The Kurdish subtitle face, bundled rather than fetched.
 *
 * NRT is chosen for the Sorani track and is not on Google Fonts, so it is a file
 * in `./fonts/` served by this site. It is offered as a subtitle font in
 * `player.subtitleStyle.fonts` and nowhere else, so it is not preloaded: an
 * `@font-face` is only fetched when something on the page actually uses it, and
 * only a viewer who picks it ever does. The file is the Bold cut, which is why
 * the weight below is `700` rather than a range.
 */
const kurdishFont = localFont({
  src: './fonts/NRT-Bd.ttf',
  weight: '700',
  style: 'normal',
  display: 'swap',
  variable: '--font-nrt',
  preload: false,
});

/**
 * The owner-verification tags, or `undefined` when none are configured.
 *
 * Built rather than passed straight through so an empty string in the config
 * omits its tag instead of emitting `<meta name="google-site-verification"
 * content="">`, which is a claim of ownership with no proof in it.
 */
function verification() {
  const configured = site.seo.verification ?? {};
  const tags = {};

  if (configured.google) tags.google = configured.google;
  if (configured.other && Object.keys(configured.other).length) tags.other = configured.other;

  return Object.keys(tags).length ? tags : undefined;
}

/** The site's origin without a trailing slash; mirrors `robots.js` and `cards.jsx`. */
function siteBase() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim()).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/**
 * The site-wide social share image, as a URL Next.js can resolve against
 * `metadataBase`.
 *
 * This exists because a file-based `opengraph-image` only covers the segment it
 * lives in. `src/app/opengraph-image.js` is in the root segment, so it supplies
 * the richer tags on `/` — type, width, height, alt — and outranks the metadata
 * object there. Child routes like `/settings` inherit nothing from it, so this
 * gives them the same card, just with fewer tags. Without it, sharing any page
 * other than the home page produces a bare link with no preview image.
 *
 * A configured `seo.ogImage` wins, since that is the deliberate override.
 */
function socialImage() {
  return site.seo.ogImage || '/opengraph-image';
}

/**
 * Site-level structured data.
 *
 * `SearchAction` is what lets a search engine offer your own search box under
 * the result rather than only a link. The placeholder and the `query-input`
 * string are part of the schema.org vocabulary and must be spelled exactly;
 * `q` is the parameter `SearchBar.js` and `/search` actually use.
 */
function websiteSchema() {
  const base = siteBase();

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.brand.name,
    description: site.seo.description,
    url: base,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${base}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

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
  verification: verification(),
  openGraph: {
    type: 'website',
    siteName: site.brand.name,
    title: site.seo.defaultTitle,
    description: site.seo.description,
    images: [socialImage()],
  },
  twitter: {
    card: 'summary_large_image',
    title: site.seo.defaultTitle,
    description: site.seo.description,
    creator: site.seo.twitterHandle || undefined,
    images: [socialImage()],
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
      className={`${brandFont.variable} ${kurdishFont.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Colour tokens generated from config/site.js */}
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        {/* Applies the saved theme before first paint, preventing a flash */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
        {/* Structured data is a JSON string, not markup we control the shape of */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema()) }}
        />
      </head>
      <body className="bg-bg text-text antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
