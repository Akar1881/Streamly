// http.js — fetch with a timeout, implemented with a pure Promise.race so it
// works everywhere. We deliberately do NOT use AbortController / fetch({signal}):
// Nuvio's Hermes runtime does not accept a signal option and throws, which broke
// every provider. Promise.race can't cancel the underlying request, but the
// caller stops waiting on timeout, which is all we need.
function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

function fetchT(url, opts, ms) {
  return Promise.race([fetch(url, opts), timeout(ms || 8000)]);
}

// Bounds the body read too (for SSE/streaming endpoints like MovieNight, where
// res.text() would otherwise hang long after headers arrive).
function fetchTextT(url, opts, ms) {
  const work = (async () => {
    const res = await fetch(url, opts);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, url: res.url };
  })();
  return Promise.race([work, timeout(ms || 8000)]);
}

module.exports = { fetchT, fetchTextT };
