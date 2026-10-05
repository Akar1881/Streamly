import { NextResponse } from 'next/server';
import site from '@config/site';
import { tmdbFetch, TmdbError } from '@/lib/tmdb/client';

/**
 * ============================================================================
 *  TMDB PROXY
 * ============================================================================
 *  Client Components (filters, infinite scroll, the search box) need TMDB data
 *  after the page has loaded. They call this route instead of TMDB directly, so
 *  the API key stays on the server and never reaches the browser.
 *
 *    /api/tmdb/search/multi?query=runner  ->  TMDB /search/multi?query=runner
 *
 *  Only the read-only endpoints the UI actually uses are allowed through, so
 *  this cannot be used as an open proxy.
 * ============================================================================
 */

const ALLOWED_PREFIXES = [
  'trending/',
  'movie/',
  'tv/',
  'discover/',
  'search/',
  'person/',
  'genre/',
  'collection/',
  'network/',
  'company/',
  'configuration/',
];

function isAllowed(path) {
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function GET(request, { params }) {
  const { path } = await params;
  const endpoint = (path ?? []).join('/');

  if (!endpoint || !isAllowed(endpoint)) {
    return NextResponse.json({ error: 'Endpoint not allowed' }, { status: 403 });
  }

  // Forward the caller's query string, minus anything that could override auth.
  const incoming = request.nextUrl.searchParams;
  const forwarded = {};
  for (const [key, value] of incoming.entries()) {
    if (key === 'api_key' || key === 'session_id') continue;
    forwarded[key] = value;
  }

  try {
    const data = await tmdbFetch(endpoint, {
      params: forwarded,
      revalidate: site.tmdb.revalidate.search,
    });

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': `public, s-maxage=${site.tmdb.revalidate.search}, stale-while-revalidate=86400`,
      },
    });
  } catch (error) {
    const status = error instanceof TmdbError ? error.status : 500;
    return NextResponse.json(
      { error: error.message ?? 'Request failed' },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
