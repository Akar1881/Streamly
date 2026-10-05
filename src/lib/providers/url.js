/**
 * Builds a provider's query string, dropping anything empty.
 *
 * Every provider spells its options differently — vidsrc wants `autoplay=1`,
 * VidFast wants `autoPlay=true` — so the provider modules decide the keys and
 * this only handles the mechanics.
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
