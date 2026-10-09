// test.js
import { inspectVidrock } from './vidrock.js';

async function test() {
    try {
        console.log('Testing VidRock Movie (TMDB: 533535)...');
        const movieResult = await inspectVidrock({ tmdbId: '533535', mediaType: 'movie' });
        console.log('Movie Result:', JSON.stringify(movieResult, null, 2));

        console.log('\nTesting VidRock TV Show (TMDB: 94997, S01E01)...');
        const tvResult = await inspectVidrock({ tmdbId: '94997', mediaType: 'tv', season: 1, episode: 1 });
        console.log('TV Result:', JSON.stringify(tvResult, null, 2));
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

test();