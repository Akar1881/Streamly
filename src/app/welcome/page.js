import site from '@config/site';
import SetupWizard from '@/components/settings/SetupWizard';
import { describe, writable } from '@/lib/settings';

/**
 * ============================================================================
 *  WELCOME — the first-run screen
 * ============================================================================
 *
 *  A server component wrapping `SetupWizard`, which is where the steps are. The
 *  split is the same one `/settings` makes: the fields and their words are read
 *  here, from the config and from `describe()`, and the component receives them
 *  rather than fetching them. The only thing the wizard does over the network
 *  is save.
 *
 *  The desktop shell opens this URL instead of the catalogue when it has never
 *  been through it, and links to it from `/settings` so it can be run again.
 *  Reachable by hand as well, which is how it gets tested outside the app.
 *
 *  ---------------------------------------------------------------------------
 *  Not for indexing
 *  ---------------------------------------------------------------------------
 *
 *  A setup screen with no content and no purpose for a visitor arriving from a
 *  search result. `noindex` rather than a `robots.txt` rule, because this is
 *  about this one page rather than the whole origin — and it is deliberately
 *  left out of `src/app/sitemap.js`.
 *
 *  Rendered per request for the same reason as `/settings`: `writable()` is a
 *  fact about the machine, not about the build.
 * ============================================================================
 */

export const metadata = {
  title: 'Welcome',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function WelcomePage() {
  const { fields, words } = describe();

  return (
    <div className="px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl">
        <SetupWizard fields={fields} words={words} writable={writable()} copy={site.welcome} />
      </div>
    </div>
  );
}
