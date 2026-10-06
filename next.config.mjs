/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    /**
     * Serve images straight from TMDB's CDN instead of proxying them through
     * `/_next/image`.
     *
     * Next.js's optimizer is on by default: every `<Image>` becomes a request
     * to Vercel's serverless transformation service, which bills against an
     * image-optimization quota *and* counts the same bytes again as Fast Data
     * Transfer. On a media-heavy catalogue that cap is reached in days, after
     * which the endpoint starts refusing to serve and posters stop loading.
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
         * them on every navigation. They never change between deploys, so pin
         * them for a year.
         *
         * (Assets under `/_next/static` are already immutable and hashed —
         * this rule does not need to cover them.)
         */
        source: '/:file(.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2))',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
