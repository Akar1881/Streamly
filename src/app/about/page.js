import site from '@config/site';
import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  ABOUT
 * ============================================================================
 *
 *  What the site is, that it is not finished, who made it, and where to follow
 *  along. Every word comes from `site.about` in `config/site.js` — this file is
 *  layout only, so the copy can be changed without reading JSX.
 *
 *  The credit is a handle and nothing more. No name, location or phone number:
 *  this page is public and indexed, and scrapers harvest exactly that kind of
 *  detail. Telegram reaches the same person and can be blocked.
 *
 *  A server component: nothing here is interactive, so it ships as HTML and
 *  needs no JavaScript to read.
 * ============================================================================
 */

export const metadata = {
  title: 'About',
  description:
    'What Streamly is, who makes it, and what state it is in. ' +
    'Movies and TV in one place, still under development.',
  /**
   * The page has no query strings or variants, so this is only here to state
   * that outright — `/about` is the one URL that should rank for it.
   */
  alternates: { canonical: '/about' },
};

function SectionHeading({ children }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

export default function AboutPage() {
  const { about, brand, footer } = site;
  const { status, maker, community } = about;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">About</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{about.intro}</p>

          {/*
            The credit, kept to a single line. `credit` is a handle rather than
            a name, which is the whole point — see the note in `config/site.js`.
          */}
          <p className="mt-4 text-sm text-muted">
            Made by <span className="font-medium text-text">{maker.credit}</span>
          </p>
        </header>

        {/*
          The unfinished-site notice. `status` can be deleted from the config
          once it stops being true and the page simply stops showing this.
        */}
        {status && (
          <div className="mt-6 flex gap-3 rounded-[var(--radius-card)] border border-line bg-card p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted">
              <Icon name="info" size={18} />
            </span>
            <div>
              <p className="text-sm font-medium">{status.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{status.message}</p>
            </div>
          </div>
        )}

        {/* ---------------- community ---------------- */}
        <section className="mt-8">
          <div className="rounded-[var(--radius-card)] border border-line bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight">{community.title}</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{community.message}</p>

            <a
              href={community.href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-5 inline-flex h-11 shrink-0 items-center justify-center gap-2
                rounded-[var(--radius-pill)] border border-transparent bg-accent px-5 text-sm
                font-medium text-accent-text transition-all hover:opacity-90 active:scale-95"
            >
              <Icon name="send" size={16} />
              {community.action}
            </a>
          </div>
        </section>

        {/* ---------------- the site ---------------- */}
        <section className="mt-8 border-t border-line pt-6">
          <SectionHeading>About the site</SectionHeading>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {brand.name} is a catalogue. It indexes what is available and where to watch it; the
            video itself is streamed by third-party services.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted opacity-80">{footer.disclaimer}</p>
        </section>
      </div>
    </div>
  );
}
