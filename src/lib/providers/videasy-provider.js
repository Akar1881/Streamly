function proxiedStreamUrl(url, playback) {
  const query = new URLSearchParams({
    url,
    referer: playback.playerFullUrl,
    origin: playback.origin,
  });
  return `/api/videasy/proxy?${query}`;
}

/**
 * What viewers are told this source is called.
 *
 * A codename, and that is the rule for every provider here rather than a
 * flourish on this one — the real name of a service is never put in front of a
 * viewer. The module's `id` keeps the true identity, for us; everything the
 * viewer can see comes from this. Anything added to `src/lib/providers/` should
 * follow the same rule, and `src/lib/providers/index.js` documents it as part
 * of the contract.
 */
const CODENAME = 'Alpha';

export default {
  id: 'videasy',
  label: CODENAME,

  async resolve({ mediaType, tmdbId, season, episode, signal }) {
    const response = await fetch('/api/videasy/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType, tmdbId, season, episode }),
      signal,
    });

    if (!response.ok) throw new Error(`Videasy resolution failed (${response.status}).`);

    const playback = await response.json();
    if (!Array.isArray(playback.streamUrls) || playback.streamUrls.length === 0) return null;

    return {
      sources: playback.streamUrls.map((url, index) => ({
        src: proxiedStreamUrl(url, playback),
        type: 'application/x-mpegURL',
        label: `${CODENAME} ${index + 1}`,
      })),
    };
  },
};