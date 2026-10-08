import site from '../../../config/site.js';
import { parseSubtitle, toVtt } from '../subtitles/srt.js';
import { inspectVideasy } from './videasy.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 4;
const MAX_SEGMENTS = 600;
const SEGMENT_CONCURRENCY = 8;

function parseAttributes(line) {
  const attributes = {};
  const list = line.slice(line.indexOf(':') + 1);
  const pattern = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))(?:,|$)/gi;
  for (const match of list.matchAll(pattern)) attributes[match[1].toUpperCase()] = match[2] ?? match[3];
  return attributes;
}

function sourceLanguageMatches(language) {
  const requested = String(site.subtitles.sourceLanguage ?? '').toLowerCase().split(/[-_]/)[0];
  const actual = String(language ?? '').toLowerCase().split(/[-_]/)[0];
  const aliases = { en: ['en', 'eng', 'english'], eng: ['en', 'eng', 'english'] };
  return Boolean(aliases[requested]?.some((alias) => actual === alias || actual.startsWith(`${alias} `)));
}

function parseHostToken(value) {
  const text = String(value ?? '').trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      return String(parsed.token ?? parsed.data ?? parsed.string ?? parsed.result ?? '');
    }
  } catch {}
  return text;
}

function addToken(url, token) {
  if (!token) return url;
  if (url.pathname.includes('__TOKEN__')) {
    url.pathname = url.pathname.replaceAll('__TOKEN__', token);
  } else if (!url.searchParams.has('token')) {
    url.searchParams.set('token', token);
  }
  return url;
}

async function fetchText(value, context, tokenState, baseUrl = context.origin) {
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== context.origin) return null;

  const needsPathToken = url.pathname.includes('__TOKEN__');
  let token = url.searchParams.get('token') ?? '';
  if (!token || needsPathToken) {
    if (!tokenState.loaded) {
      tokenState.loaded = true;
      try {
        const tokenResponse = await fetch(new URL('/generate.php', context.origin), {
          headers: context.headers,
          cache: 'no-store',
          signal: context.signal,
        });
        if (tokenResponse.ok) tokenState.token = parseHostToken(await tokenResponse.text());
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
    }
    token = tokenState.token || token;
    url = addToken(url, token);
  }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, {
      headers: context.headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: context.signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === MAX_REDIRECTS) return null;
      const redirected = new URL(location, url);
      if (redirected.protocol !== 'https:' || redirected.origin !== context.origin) return null;
      url = addToken(redirected, token);
      continue;
    }
    if (!response.ok) return null;
    return { text: await response.text(), url };
  }
  return null;
}

function timestampMilliseconds(value) {
  const match = String(value).match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!match) return null;
  return (
    Number(match[1] ?? 0) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1000 +
    Number(match[4].padEnd(3, '0'))
  );
}

function segmentOffset(text) {
  const match = text.match(/X-TIMESTAMP-MAP=LOCAL:([^,\s]+),MPEGTS:(\d+)/i);
  if (!match) return 0;
  const local = timestampMilliseconds(match[1]);
  return local === null ? 0 : Number(match[2]) / 90 - local;
}

async function readSubtitleResource(value, context, tokenState, baseUrl, depth = 0) {
  if (depth > 2) return null;
  const resource = await fetchText(value, context, tokenState, baseUrl);
  if (!resource) return null;
  if (!resource.text.trimStart().startsWith('#EXTM3U')) {
    const cues = parseSubtitle(resource.text);
    return cues.length ? cues : null;
  }

  const segments = resource.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, MAX_SEGMENTS);
  if (!segments.length) return null;

  const results = [];
  for (let index = 0; index < segments.length; index += SEGMENT_CONCURRENCY) {
    const batch = await Promise.all(
      segments.slice(index, index + SEGMENT_CONCURRENCY).map(async (segment) => {
        const fetched = await fetchText(segment, context, tokenState, resource.url);
        if (!fetched || fetched.text.trimStart().startsWith('#EXTM3U')) return [];
        const offset = segmentOffset(fetched.text);
        return parseSubtitle(fetched.text).map((cue) => ({
          ...cue,
          startMs: Math.max(0, cue.startMs + offset),
          endMs: Math.max(1, cue.endMs + offset),
        }));
      }),
    );
    results.push(...batch.flat());
  }

  const unique = new Map();
  for (const cue of results) {
    unique.set(`${cue.startMs}:${cue.endMs}:${cue.text}`, cue);
  }
  return [...unique.values()].sort((left, right) => left.startMs - right.startMs);
}

function subtitleRenditions(master) {
  return master
    .split(/\r?\n/)
    .filter((line) => /^#EXT-X-MEDIA:/i.test(line))
    .map(parseAttributes)
    .filter((track) => track.TYPE?.toUpperCase() === 'SUBTITLES');
}

/** Finds an HLS subtitle rendition in the configured source language, or returns null. */
export async function extractVideasySubtitle(playback, request = {}) {
  try {
    for (const streamUrl of playback.streamUrls) {
      const context = {
        origin: new URL(streamUrl).origin,
        signal: request.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          Referer: playback.playerFullUrl,
          Origin: playback.origin,
        },
      };
      const tokenState = { loaded: false, token: '' };
      const master = await fetchText(streamUrl, context, tokenState);
      if (!master || !master.text.trimStart().startsWith('#EXTM3U')) continue;

      const renditions = subtitleRenditions(master.text).filter((track) =>
        sourceLanguageMatches(track.LANGUAGE ?? track.NAME),
      );
      for (const rendition of renditions) {
        if (!rendition.URI) continue;
        const cues = await readSubtitleResource(rendition.URI, context, tokenState, master.url);
        if (cues?.length) {
          return {
            vtt: toVtt(cues),
            language: rendition.LANGUAGE ?? site.subtitles.sourceLanguage,
            source: 'videasy-hls',
          };
        }
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    console.warn(`[subtitles] Videasy HLS captions unavailable: ${error?.message ?? error}`);
  }

  return null;
}

export async function fetchVideasySubtitle(request) {
  try {
    const playback = await inspectVideasy(request.tmdbId, {
      mediaType: request.mediaType,
      season: request.season,
      episode: request.episode,
      signal: request.signal,
    });
    return await extractVideasySubtitle(playback, request);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    console.warn(`[subtitles] Videasy HLS captions unavailable: ${error?.message ?? error}`);
    return null;
  }
}
