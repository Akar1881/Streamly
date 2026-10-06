#!/usr/bin/env node
/**
 * ============================================================================
 *  SUBTITLE PROBE  (development helper — not part of the app)
 * ============================================================================
 *
 *  Dumps the raw responses from the two services the subtitle feature depends
 *  on, so their shape can be confirmed against reality instead of inferred:
 *
 *    node --env-file=.env.local scripts/subtitle-probe.mjs 550
 *
 *  The argument is a TMDB id (550 is Fight Club) and is optional.
 *
 *  This is a probe, not the pipeline — it deliberately duplicates the translate
 *  URL template rather than importing `src/lib/subtitles/*`, because those use
 *  the `@/` and `@config/` path aliases that Node itself does not resolve. It
 *  answers one question: what do these APIs actually send back?
 * ============================================================================
 */

import { parseToVTT, searchSubtitles, withDownloadOptions } from 'wyzie-lib';

const tmdbId = Number(process.argv[2] ?? 550);

const wyzieKey = process.env.WYZIE_API_KEY?.trim();
const translateKey = process.env.TRANSLATE_API_KEY?.trim();

console.log('─'.repeat(72));
console.log(`Subtitle probe — TMDB ${tmdbId}`);
console.log(`  WYZIE_API_KEY     ${wyzieKey ? `set (…${wyzieKey.slice(-4)})` : 'MISSING'}`);
console.log(`  TRANSLATE_API_KEY ${translateKey ? `set (…${translateKey.slice(-4)})` : 'MISSING'}`);
console.log('─'.repeat(72));

if (!wyzieKey || !translateKey) {
  console.error('\nBoth keys are required. Put them in .env.local and pass --env-file.');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  1. The subtitle source                                            */
/* ------------------------------------------------------------------ */

console.log('\n[1/2] Wyzie — searching for an English subtitle\n');

let subtitle = null;

try {
  const results = await searchSubtitles({
    tmdb_id: tmdbId,
    language: 'en',
    format: ['srt', 'vtt'],
    key: wyzieKey,
  });

  console.log(`  ${results.length} result(s)`);

  for (const result of results.slice(0, 5)) {
    console.log(
      `   • ${result.language} ${result.format ?? '?'} ` +
        `${result.isHearingImpaired ? '[HI] ' : ''}${result.source ?? ''} — ${result.release ?? ''}`,
    );
  }

  subtitle = results.find((result) => !result.isHearingImpaired) ?? results[0] ?? null;
} catch (error) {
  console.error(`  FAILED: ${error.name} ${error.status ?? ''} ${error.message}`);
}

if (subtitle) {
  try {
    const url = withDownloadOptions(subtitle, { to: 'vtt', plain: true });
    const vtt = await parseToVTT(url);

    console.log(`\n  Chosen: ${subtitle.release ?? subtitle.fileName ?? subtitle.id}`);
    console.log('  First 300 characters of the WebVTT:\n');
    console.log(
      vtt
        .slice(0, 300)
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n'),
    );
  } catch (error) {
    console.error(`  DOWNLOAD FAILED: ${error.name} ${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/*  2. The translator                                                 */
/* ------------------------------------------------------------------ */

console.log('\n[2/2] Google — translating three lines en → ckb\n');

// Deliberately three lines with awkward content: a contraction, a question and
// a hyphenated interruption, which is what a subtitle cue looks like. The point
// is to see whether the response comes back as one piece per line.
const sample = ['I told you not to come here.', 'What was I supposed to do?', '- Run!'];

const url = new URL('https://translate-pa.googleapis.com/v1/translate');
url.searchParams.set('params.client', 'gtx');
url.searchParams.set('query.source_language', 'en');
url.searchParams.set('query.target_language', 'ckb');
url.searchParams.set('query.display_language', 'en-US');
url.searchParams.set('query.text', sample.join('\n'));
url.searchParams.set('key', translateKey);
url.searchParams.append('data_types', 'TRANSLATION');
url.searchParams.append('data_types', 'SENTENCE_SPLITS');
url.searchParams.append('data_types', 'BILINGUAL_DICTIONARY_FULL');

console.log(`  URL length: ${url.toString().length} characters`);

try {
  const response = await fetch(url);
  const body = await response.text();

  console.log(`  HTTP ${response.status} ${response.statusText}`);
  console.log(`  Content-Type: ${response.headers.get('content-type')}`);
  console.log('\n  Raw body:\n');
  console.log(
    body
      .slice(0, 4000)
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n'),
  );

  if (body.length > 4000) console.log(`    … ${body.length - 4000} more characters`);

  // A quick read of the two shapes the parser accepts, so the answer is
  // visible without decoding the JSON by eye.
  try {
    const data = JSON.parse(body);
    const pieces = Array.isArray(data.sentences)
      ? data.sentences.map((sentence) => sentence?.trans ?? sentence?.translatedText ?? sentence?.text)
      : Array.isArray(data.translations)
        ? data.translations.map((entry) => entry?.translatedText ?? entry?.text)
        : [data.translation ?? data.translatedText];

    const clean = pieces.filter((piece) => typeof piece === 'string');

    console.log(`\n  Shape: ${Array.isArray(data.sentences) ? 'sentences[]' : Array.isArray(data.translations) ? 'translations[]' : 'flat string'}`);
    console.log(`  Extracted ${clean.length} piece(s) for ${sample.length} input lines:`);
    clean.forEach((piece, index) => console.log(`    [${index}] ${JSON.stringify(piece)}`));
    console.log(`\n  → ${clean.length === sample.length ? 'ALIGNED ✔ one piece per line' : 'NOT aligned by this reading ✘ — parser needs the real shape'}`);
  } catch {
    console.log('\n  (Body was not JSON — the status code above is the answer.)');
  }
} catch (error) {
  console.error(`  REQUEST FAILED: ${error.message}`);
}

console.log(`\n${'─'.repeat(72)}`);
