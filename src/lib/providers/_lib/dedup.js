// dedup.js — Nuvio itself runs all providers concurrently and shows results as
// they arrive, so you do NOT port the Dart ScraperManager. But within a single
// provider that queries several sub-sources (e.g. Videasy's 5 CDNs), you still
// want to drop duplicates before returning.

// Dedup a stream array by playable URL.
function dedupByUrl(streams) {
  const seen = new Set();
  const out = [];
  for (const s of streams) {
    if (!s || !s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

// Sort best-quality first so Nuvio shows 4K/1080p above CAM.
const RANK = { '4K': 5, '2160p': 5, '1080p': 4, '720p': 3, '480p': 2, 'CAM': 1 };
function sortByQuality(streams) {
  return streams.slice().sort((a, b) => (RANK[b.quality] || 0) - (RANK[a.quality] || 0));
}

// Best-effort quality label from a title/name string.
function parseQuality(s) {
  const t = String(s || '');
  if (/2160|\b4k\b|uhd/i.test(t)) return '2160p';
  if (/1080/.test(t)) return '1080p';
  if (/720/.test(t)) return '720p';
  if (/480/.test(t)) return '480p';
  if (/\bcam\b/i.test(t)) return 'CAM';
  return 'Auto';
}

module.exports = { dedupByUrl, sortByQuality, parseQuality };
