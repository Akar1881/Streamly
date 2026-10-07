const rivestream = require('./rivestream');

// Test cases using popular TMDB IDs
const TESTS = [
    { label: 'Movie: The Matrix (TMDB 603)', type: 'movie', tmdbId: 603 },
    { label: 'TV Show: Stranger Things S01E01 (TMDB 66732)', type: 'tv', tmdbId: 66732, season: 1, episode: 1 }
];

async function runTests() {
    console.log('==================================================');
    console.log('       RIVESTREAM DEDICATED TEST SUITE          ');
    console.log('==================================================\n');

    for (const test of TESTS) {
        console.log(`--------------------------------------------------`);
        console.log(`Testing -> ${test.label}`);
        console.log(`--------------------------------------------------`);

        process.stdout.write(`  ⏳ [RiveStream] Querying providers... `);
        const startTime = Date.now();

        try {
            const streams = await rivestream.getStreams(
                test.tmdbId,
                test.type,
                test.season,
                test.episode
            );
            const duration = Date.now() - startTime;

            if (Array.isArray(streams) && streams.length > 0) {
                console.log(`✅ SUCCESS (${streams.length} unique quality stream(s) found in ${duration}ms)\n`);

                streams.forEach((stream, idx) => {
                    console.log(`  [Stream #${idx + 1}]`);
                    console.log(`    Name     : ${stream.name}`);
                    console.log(`    Title    : ${stream.title}`);
                    console.log(`    Quality  : ${stream.quality}`);
                    console.log(`    Full URL : ${stream.url}`);
                    console.log(`    Headers  :`, JSON.stringify(stream.headers));
                    console.log('');
                });

                // Print the single unified English subtitle list from the first stream (they all share it now)
                const subs = streams[0]?.subtitles || [];
                if (subs.length > 0) {
                    console.log(`  📝 Shared English Subtitles (${subs.length} available):`);
                    subs.forEach((sub, sIdx) => {
                        console.log(`      (${sIdx + 1}) [${sub.language}] ${sub.url}`);
                    });
                } else {
                    console.log(`  📝 Shared English Subtitles: None found`);
                }
                console.log('');
            } else {
                console.log(`⚠️  NO STREAMS FOUND (${duration}ms)\n`);
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            console.log(`❌ ERROR (${duration}ms): ${error.message}\n`);
        }
    }

    console.log('==================================================');
    console.log('               TEST RUN COMPLETE                  ');
    console.log('==================================================');
}

runTests();
