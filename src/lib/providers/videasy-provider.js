function proxiedStreamUrl(url, playback) {
  const query = new URLSearchParams({
    url,
    referer: playback.playerFullUrl,
    origin: playback.origin,
  });
  return `/api/videasy/proxy?${query}`;
}

export default {
  id: 'videasy',
  label: 'Videasy',

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
        label: `Videasy ${index + 1}`,
      })),
    };
  },
};