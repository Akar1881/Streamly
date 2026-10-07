/**
 * Builds a provider's query string, dropping anything empty.
 *
 * Providers spell their options differently — one wants `autoplay=1`, another
 * `autoPlay=true`, a third nothing at all — so each provider module decides the
 * keys and this only handles the mechanics. Kept here, next to the providers,
 * because it is the one bit of URL-building they all end up wanting.
 */
export function withQuery(url, params) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    query.set(key, String(value));
  }

  const suffix = query.toString();
  return suffix ? `${url}?${suffix}` : url;
}
