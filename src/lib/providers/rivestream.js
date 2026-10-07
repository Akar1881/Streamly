// RiveStream — multi-provider HLS/MP4 from scrapper.rivestream.app
// Returns all available English quality streams, proper playback headers, and a unified English subtitles list.
const { fetchT } = require('./_lib/http');

const API = 'https://scrapper.rivestream.app';
const UA =
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://www.rivestream.app/', Origin: 'https://www.rivestream.app', Accept: 'application/json, text/plain, */*' };
const FALLBACK = ['apex', 'pulse', 'solstice', 'quasar', 'primevids', 'flowcast', 'citadel', 'guru', 'asiacloud', 'horizon', 'hindicast'];

const QUALITY_RANK = { '4k': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1, 'auto': 0 };

function parseQuality(q) {
  const clean = String(q || 'auto').toLowerCase();
  for (const key of Object.keys(QUALITY_RANK)) {
    if (clean.includes(key)) return key;
  }
  return 'auto';
}

// Markers indicating non-English content to ignore
const NON_ENGLISH_MARKERS = ['hindi', 'spanish', 'french', 'german', 'arabic', 'portuguese', 'russian', 'italian', 'jap', 'jpn', 'kor', 'dubbed'];

function isNonEnglish(text) {
  const lower = String(text || '').toLowerCase();
  return NON_ENGLISH_MARKERS.some(lang => lower.includes(lang));
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const out = [];
  const seenUrls = new Set();
  const seenQualities = new Set();
  let sharedEnglishSubtitles = [];

  try {
    const isTv = mediaType === 'tv';
    let providers = FALLBACK;
    try {
      const r = await fetchT(`${API}/api/providers`, { headers: HEADERS }, 3000);
      if (r.ok) {
        const d = await r.json();
        if (d && Array.isArray(d.data)) providers = d.data.map(String);
        else if (Array.isArray(d)) providers = d.map(String);
      }
    } catch (e) {}

    const cb = Math.floor(Date.now() / 3000000);
    await Promise.all(providers.map(async (provider) => {
      try {
        const cbParam = provider === 'primevids' || provider === 'citadel' ? `&cb=${cb}` : '';
        const ep = isTv
        ? `${API}/api/provider?provider=${provider}&id=${tmdbId}&season=${season || 1}&episode=${episode || 1}${cbParam}`
        : `${API}/api/provider?provider=${provider}&id=${tmdbId}${cbParam}`;
        const res = await fetchT(ep, { headers: HEADERS }, 7000);
        if (!res.ok) return;
        const data = await res.json();
        const sources = data && data.data && data.data.sources;
        if (!Array.isArray(sources)) return;

        // Capture English-only subtitles if we haven't found them yet
        if (sharedEnglishSubtitles.length === 0) {
          const rawSubs = (data.data && (data.data.subtitles || data.data.captions || data.data.subs)) || [];
          if (Array.isArray(rawSubs) && rawSubs.length > 0) {
            sharedEnglishSubtitles = rawSubs.map(sub => {
              let lang = sub.language || sub.lang || '';
              const subUrl = sub.url || sub.file || '';

              if ((!lang || lang.toLowerCase() === 'unknown') && subUrl) {
                const match = subUrl.match(/\/([^/]+)\.vtt(\?|$)/i);
                if (match) {
                  lang = decodeURIComponent(match[1]).replace(/[_]/g, ' ').replace(/(\d+|Hi|CC)$/i, '').trim();
                }
              }
              return { language: lang || 'English', url: subUrl };
            }).filter(sub => {
              if (!sub.url) return false;
              const l = sub.language.toLowerCase();
              return l.includes('english') || l.includes('eng') || l.includes('cc');
            });
          }
        }

        for (const src of sources) {
          const url = String((src && src.url) || '').trim();
          if (!url || !url.startsWith('http') || seenUrls.has(url)) continue;

          const rawQ = src.quality || 'Auto';
          const srcName = src.source || provider;

          // Ignore non-English streams based on quality or source name
          if (isNonEnglish(rawQ) || isNonEnglish(srcName)) continue;

          const qualityTier = parseQuality(rawQ);
          if (qualityTier !== 'auto' && seenQualities.has(qualityTier)) continue;

          seenUrls.add(url);
          if (qualityTier !== 'auto') seenQualities.add(qualityTier);

          let streamHeaders = { 'User-Agent': UA, Referer: 'https://www.rivestream.app/', Origin: 'https://www.rivestream.app' };
          if (src.headers && typeof src.headers === 'object') {
            streamHeaders = { ...streamHeaders, ...src.headers };
          } else if (data.data && data.data.headers && typeof data.data.headers === 'object') {
            streamHeaders = { ...streamHeaders, ...data.data.headers };
          }

          out.push({
            name: `Rive:${srcName}`,
            title: `[Rive - ${srcName}] ${rawQ}`,
            url,
            quality: rawQ,
            headers: streamHeaders
          });
        }
      } catch (e) {}
    }));
  } catch (e) {}

  // Sort by quality weight descending
  out.sort((a, b) => {
    const qA = QUALITY_RANK[parseQuality(a.quality)] || 0;
    const qB = QUALITY_RANK[parseQuality(b.quality)] || 0;
    return qB - qA;
  });

  // Attach the shared English subtitles list to all returned quality streams
  return out.map(stream => ({
    ...stream,
    subtitles: sharedEnglishSubtitles
  }));
}

module.exports = { getStreams };
