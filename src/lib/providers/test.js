// test.js
import { inspectVideasy } from './videasy.js';

async function main() {
    try {
        console.log("Starting Videasy stream extraction for TMDB 299534...\n");
        const result = await inspectVideasy('299534');
        console.log("\nSuccess! Resolved streams:", result.streamUrls);
    } catch (err) {
        console.error("\n❌ Extraction failed:", err.message);
    }
}

main();