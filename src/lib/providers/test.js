import { getStreams } from './hyper.js';

async function testSeriesIds() {
    const tests = [
        { name: 'TMDB integer format', params: { tmdbId: '1399', mediaType: 'tv', season: 1, episode: 1 } },
        { name: 'TVDB format', params: { imdbId: '121361', mediaType: 'tv', season: 1, episode: 1 } }, // Game of Thrones TVDB ID
    ];

    for (const test of tests) {
        try {
            console.log(`Testing ${test.name}...`);
            const result = await getStreams(test.params);
            console.log(`Success! Found ${result.streams.length} streams.`);
            break;
        } catch (err) {
            console.log(`Failed: ${err.message}`);
        }
    }
}

testSeriesIds();