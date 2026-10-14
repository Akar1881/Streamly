// moviestream.js
import { pathToFileURL } from 'node:url';

export class MovieStreamScraper {
    constructor() {
        this.baseUrl = 'https://0123movie.space';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://himovies.watch/'
        };
    }

    async getMediaSources(type, primaryId, secondaryId, episode = null) {
        let endpoint;

        if (type === 'tv') {
            endpoint = `${this.baseUrl}/vms/${primaryId}/${secondaryId}/${episode}/`;
        } else {
            endpoint = `${this.baseUrl}/vmf/${primaryId}/${secondaryId}/`;
        }

        try {
            const res = await fetch(endpoint, {
                headers: this.headers,
                redirect: 'follow'
            });

            if (!res.ok) {
                // A title this service does not carry is answered 404, or with
                // a redirect out to another host that lands here as a 3xx. That
                // is the ordinary miss, not a fault — the caller falls back to
                // another source — so it is not worth a stack trace.
                return null;
            }

            const html = await res.text();
            return this.parsePlayerConfig(res.url, html);
        } catch (error) {
            console.error('MovieStreamScraper Error:', error);
            return null;
        }
    }

    parsePlayerConfig(embedUrl, html) {
        const sourceMatch = html.match(/sources:\s*\[\s*\{\s*file:\s*['"]([^'"]+)['"]/);
        const streamUrl = sourceMatch ? sourceMatch[1] : null;

        const imageMatch = html.match(/image:\s*['"]([^'"]+)['"]/);
        const posterImage = imageMatch ? imageMatch[1] : null;

        const durationMatch = html.match(/duration:\s*['"]([^'"]+)['"]/);
        const duration = durationMatch ? parseInt(durationMatch[1], 10) : 0;

        const tracks = [];
        const trackRegex = /\{\s*file:\s*['"]([^'"]+)['"],\s*(?:label:\s*['"]([^'"]+)['"],\s*)?kind:\s*['"]([^'"]+)['"](?:,\s*"default":\s*(true|false))?\s*\}/g;

        let match;
        while ((match = trackRegex.exec(html)) !== null) {
            tracks.push({
                file: match[1],
                label: match[2] || null,
                kind: match[3],
                default: match[4] === 'true'
            });
        }

        // Playback headers required when fetching the HLS stream chunks/manifest
        const playbackHeaders = {
            'User-Agent': this.headers['User-Agent'],
            'Referer': embedUrl
        };

        return {
            embedUrl,
            streamUrl,
            playbackHeaders,
            posterImage,
            duration,
            tracks
        };
    }
}

// --- Test Execution ---
async function runTests() {
    const scraper = new MovieStreamScraper();

    console.log('--- Testing Movie Stream (IMDb / TMDB) ---');
    const movieData = await scraper.getMediaSources('movie', 'tt32269489', '1744819');
    console.log(JSON.stringify(movieData, null, 2));

    console.log('\n--- Testing TV Show Stream (TMDB / Season / Episode) ---');
    const tvData = await scraper.getMediaSources('tv', '4604', '4', '22');
    console.log(JSON.stringify(tvData, null, 2));
}

// Only when this file is run directly — `node src/lib/providers/himovies.js`.
// Everything above is unchanged; this line is here because the route imports
// this module now, and without it every cold start would fire both test
// lookups before answering a request.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runTests();
}
