// test.js
import { getStreams } from './torrent.js'; // Match your actual filename (e.g., torrent.js or torrastream.js)

async function runTest() {
  console.log('Testing stream fetcher...');
  
  const tmdbId = '969681';
  const mediaType = 'movie';

  try {
    const streams = await getStreams(tmdbId, mediaType);
    
    console.log(`\nFound ${streams.length} streams:\n`);
    streams.forEach((stream, index) => {
      console.log(`--- Stream ${index + 1} ---`);
      console.log(`Title:    ${stream.title}`);
      console.log(`Quality:  ${stream.quality}`);
      console.log(`URL:      ${stream.url}`);
    });
  } catch (error) {
    console.error('Error fetching streams:', error);
  }
}

runTest();