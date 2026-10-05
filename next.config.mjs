/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // TMDB serves every poster, backdrop, logo and profile photo from this host.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
    ],
  },
};

export default nextConfig;
