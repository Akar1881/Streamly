/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * The desktop build.
   *
   * `standalone` asks Next to emit `.next/standalone/server.js` — a server with
   * its own trimmed `node_modules` beside it, startable by anyone with Node and
   * no `next` command in sight. That is exactly what the Electron shell needs:
   * it `require`s that file from its own main process and never runs the CLI.
   *
   * Gated, and off by default, because it changes what `next build` produces
   * for everybody. A standalone build is larger, has a different output layout,
   * and is not what a deployment should be handed — so the web build stays
   * byte-for-byte what it was, and only `npm run desktop:build` sets this.
   */
  ...(process.env.STREAMLY_DESKTOP === '1' ? { output: 'standalone' } : {}),

  images: {
    /**
     * Serve images straight from TMDB's CDN instead of proxying them through
     * `/_next/image`.
     *
     * Next.js's optimizer is on by default: every `<Image>` becomes a request
     * to a serverless transformation service, which bills against an
     * image-optimization quota *and* counts the same bytes again as bandwidth.
     * On a media-heavy catalogue that cap is reached in days, after which the
     * endpoint starts refusing to serve and posters stop loading.
     *
     * With `unoptimized` each tag renders a plain `<img>` pointing at
     * `image.tmdb.org`, so image bytes never touch this deployment at all.
     * The trade-off is that `sizes`/`srcset` no longer produce multiple
     * variants — one URL per slot — so the size presets in `config/site.js`
     * are now the only thing controlling download weight. Keep them tight.
     */
    unoptimized: true,

    /**
     * Unused while `unoptimized` is on (the optimizer is what validated
     * remote hosts). Kept so the config still works if optimisation is
     * switched back on for an experiment.
     */
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        pathname: '/vi/**',
      },
    ],
  },

  async headers() {
    return [
      {
        /**
         * Files in `/public` — the logo and the favicon. Next.js serves these
         * with `Cache-Control: public, max-age=0`, so the browser re-requests
         * them on every navigation. They rarely change between deploys, so
         * give them an hour, and let the cache keep serving the copy it has
         * while the check happens behind it.
         *
         * `immutable` is deliberately absent, and so is a year-long `max-age`.
         * Both were here, and both make a promise this file cannot keep: that
         * the URL's contents will never change. The name `/logo.svg` is fixed,
         * so the browser stops asking entirely — a redesigned logo then stays
         * invisible to everyone who has already visited, including you against
         * your own dev server until the cache is emptied by hand.
         *
         * Revalidation is cheap: Next sends an ETag and a `Last-Modified`, so
         * an unchanged file costs a 304 with no body.
         *
         * (Assets under `/_next/static` are content-hashed — a new build is a
         * new URL — so this rule is about `/public`, which is not.)
         */
        source: '/:file(.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2))',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=604800',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
