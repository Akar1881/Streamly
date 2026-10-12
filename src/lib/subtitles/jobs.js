/**
 * ============================================================================
 *  SUBTITLE JOBS
 * ============================================================================
 *
 *  Runs the pipeline for one title — find the English subtitle, translate every
 *  cue, write the WebVTT to the cache — and exposes how far along it is, so the
 *  waiting screen can say something honest instead of spinning.
 *
 *  State is an in-process Map. That is enough for what it is for: two viewers
 *  opening the same film at the same time share one job rather than doing the
 *  work twice. A second server instance would run its own job — the only cost
 *  is duplicated work, since both write the same cache file, and whichever
 *  finishes first wins the rename.
 *
 *  Every failure ends as a `failed` job with a code, never a thrown error: the
 *  caller's job is to play the video either way.
 * ============================================================================
 */

import site from '@config/site';
import { cacheKey, isCached, isShared, writeCached } from './cache';
import { SubtitleError } from './error';
import { fetchProviderSubtitle } from './provider';
import { parseSubtitle, toVtt } from './srt';
import { translateCues, translateKey } from './translate';
import { fetchSourceSubtitle, findSource } from './wyzie';
import { fetchOpenSubtitle, findOpenSubtitle } from './opensubtitles';
import { fetchVideasySubtitle } from '@/lib/providers/videasy-captions';

/**
 * The mistake worth shouting about.
 *
 * A deployment with the API keys but no object storage translates perfectly and
 * then stores the result somewhere only that one instance can see — so it works
 * in development, works for the viewer who triggered it, and 404s for the next
 * person to open the same title. Nothing about that failure points at its
 * cause, so it gets said out loud, once per process, at the point the feature
 * is actually switched on.
 */
if (process.env.NODE_ENV === 'production' && site.subtitles.enabled && !isShared()) {
  console.warn(
    '[subtitles] No object storage is configured, so translated subtitles are being ' +
      'written to the local filesystem. A serverless host cannot serve those back to a ' +
      "viewer's browser. Create a Blob store in the Vercel dashboard and link it to this " +
      'project — see .env.example.',
  );
}

/** job key → job record. Finished jobs are kept briefly so late polls resolve. */
const jobs = new Map();

/**
 * job key → the original-language subtitle's link, as a promise.
 *
 * Kept apart from the jobs map because it answers a different question, asked
 * by a different caller. A job says "how far along is the translation"; this
 * says "where is the file it was made from" — and it has to be answerable for a
 * title that was translated days ago and served straight out of the store,
 * where there is no job and never will be one.
 *
 * The *promise* is stored rather than its result, so two callers asking at the
 * same moment share one search instead of spending two of the key's requests on
 * the same answer.
 */
const links = new Map();

/** How many finished jobs to remember before the oldest are dropped. */
const MAX_JOBS = 200;

/** How long a failed job is served before a new request may retry it. */
const RETRY_AFTER_MS = 60_000;

/** True when the feature has everything it needs to run. */
export function subtitlesEnabled() {
  return Boolean(site.subtitles.enabled && translateKey());
}

function createJob(key) {
  return {
    key,
    status: 'working',
    phase: 'searching',
    progress: 0,
    startedAt: Date.now(),
    endedAt: null,
    fileName: null,
    code: null,
    message: null,
    resetAt: null,
  };
}

/** Drops the oldest finished jobs once the map has grown past its cap. */
function prune() {
  if (jobs.size <= MAX_JOBS) return;

  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'working')
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));

  for (const job of finished) {
    if (jobs.size <= MAX_JOBS) break;
    jobs.delete(job.key);
  }
}

/**
 * The pipeline itself. Never throws — it turns whatever went wrong into the
 * job's `failed` state.
 *
 * Returns the work promise rather than awaiting it, because the caller has to
 * keep the invocation alive until it settles. On a serverless host the response
 * ends the request, and anything still running is frozen mid-flight unless the
 * platform is told to wait — `after()` in the route does that. Returning this
 * is what gives it something to wait for.
 */
function run(job, request) {
  const fileName = `${job.key}.vtt`;

  // The job may outlive the request that started it (that is the point of the
  // timeout below), so it updates the record rather than returning a value.
  const work = (async () => {
    // Four sources, best first, and the order is the whole of the policy.
    //
    // The provider's own subtitle leads, because it was shipped with the copy of
    // the film the viewer is watching and so its timings match the picture. It is
    // also the only one that can be *known* to match: a subtitle found separately
    // is timed to some other release, and on a film re-cut between regions it is
    // timed to some other film.
    //
    // Wyzie is next, followed by OpenSubtitles if Wyzie cannot provide a usable
    // file. Both hand back a link the player can use — the same file it gives us
    // to translate becomes the original-language track. Videasy's HLS caption
    // is the last resort: a better timing match than a separate subtitle when it
    // exists, but it only ever exists as bytes on this side, so it has no link to
    // hand out and it costs a whole second lookup.
    //
    // Each call is guarded rather than chained with `??` because Wyzie *throws*
    // on a quota cap or a missing key — a `??` would never be reached, and a
    // Wyzie limit would take down a translation the provider's own subtitle could
    // still supply. Its error is kept, though: its codes are the ones the waiting
    // screen knows how to explain.
    let source = null;
    let sourceError = null;

    if (request.sourceUrl) {
      try {
        source = await fetchProviderSubtitle(request.sourceUrl, { signal: request.signal });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        sourceError = error;
      }
    }

    if (!source) {
      try {
        source = await fetchSourceSubtitle(request);
        if (!parseSubtitle(source.vtt).length) {
          throw new SubtitleError('Wyzie returned no readable cues', 'fetch-failed');
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        sourceError = sourceError ?? error;
        source = null;
      }
    }

    if (!source) {
      try {
        source = await fetchOpenSubtitle(request);
        if (!parseSubtitle(source.vtt).length) {
          throw new SubtitleError('OpenSubtitles returned no readable cues', 'fetch-failed');
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        sourceError = sourceError ?? error;
        source = null;
      }
    }

    source ??= await fetchVideasySubtitle(request);

    if (!source) {
      throw sourceError ?? new SubtitleError('No subtitles found for this title', 'not-found');
    }

    const cues = parseSubtitle(source.vtt);
    if (!cues.length) {
      throw new SubtitleError('The source subtitle had no readable cues', 'fetch-failed');
    }

    // The original-language link is recorded here, before translating, rather
    // than read off `source` by the caller afterwards: the waiting screen wants
    // the English track *while* the Sorani one is being made, and a translation
    // that later fails or runs out of time should still leave the viewer an
    // English track to fall back on. Null when the source was the HLS caption,
    // which has no link to hand out.
    links.set(job.key, Promise.resolve(source.url ?? null));

    job.phase = 'translating';
    job.progress = 0.1;

    const texts = await translateCues(cues, {
      onProgress: (done, total) => {
        // Leave the last tenth for the write, so a bar that reaches 100% means
        // the subtitle is actually ready to serve.
        job.progress = 0.1 + 0.85 * (done / total);
      },
    });

    const translated = cues.map((cue, index) => ({ ...cue, text: texts[index] ?? cue.text }));

    const vtt = toVtt(translated, {
      header: `${site.subtitles.target.label} — machine translated`,
    });

    // Only a complete translation is written: a half-written file would be
    // served to every later viewer as if it were finished.
    await writeCached(fileName, vtt);

    return fileName;
  })();

  // The waiting screen gives up at `waitMs`; the work deliberately does not.
  // A title that takes too long still lands in the store, so the next viewer
  // gets it instantly even though this one watched without subtitles.
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(null), site.subtitles.timeoutMs);
  });

  // Settles the job record. Detached on purpose: it races the work against the
  // clock, and the caller is handed `work` so it can outlive this.
  void (async () => {
    try {
      const result = await Promise.race([work, timeout]);

      if (result === null) {
        job.status = 'failed';
        job.phase = 'failed';
        job.code = 'timeout';
        job.message = 'Translation took too long';
      } else {
        job.status = 'ready';
        job.phase = 'ready';
        job.progress = 1;
        job.fileName = result;
      }
    } catch (error) {
      const known = error instanceof SubtitleError;

      job.status = 'failed';
      job.phase = 'failed';
      job.code = known ? error.code : 'translate-failed';
      job.message = error?.message ?? 'Subtitle preparation failed';
      job.resetAt = known ? error.resetAt : null;

      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[subtitles] ${job.key}: ${job.code} — ${job.message}`);
      }
    } finally {
      job.endedAt = Date.now();
      prune();

      // A job that timed out is still running: let it finish and publish its
      // result, so a poll that arrives after it lands finds the stored file
      // rather than the timeout.
      if (job.code === 'timeout') {
        work
          .then((name) => {
            job.status = 'ready';
            job.phase = 'ready';
            job.progress = 1;
            job.fileName = name;
            job.code = null;
            job.message = null;
            job.endedAt = Date.now();
          })
          .catch(() => {});
      }
    }
  })();

  return work;
}

/**
 * Starts preparing the subtitle for a title, or joins the job already working
 * on it, or answers from the store.
 *
 * Returns the job *and* the work promise. The job is what the waiting screen
 * polls; the promise is what the route hands to `after()` so the platform does
 * not freeze the translation the moment the first response goes out. It is null
 * whenever there was nothing to do — a stored hit, or a failure that was
 * decided without starting.
 *
 * @param {object} request
 * @param {'movie'|'tv'} request.mediaType
 * @param {number} request.tmdbId
 * @param {number} [request.season]
 * @param {number} [request.episode]
 * @param {string} [request.sourceUrl]  the playing provider's own subtitle, if it
 *        offered one — tried before anything we go looking for. Deliberately not
 *        part of the cache key: the translation is stored per title, so the first
 *        viewer's source is the one every later viewer gets, and a faster source
 *        for the same film is not worth a second translation of it.
 * @returns {Promise<{ job: object, work: Promise<string>|null }>} — never throws
 */
export async function prepareSubtitle(request) {
  const key = cacheKey(request);

  if (!subtitlesEnabled()) {
    return {
      work: null,
      job: {
        ...createJob(key),
        status: 'failed',
        phase: 'failed',
        code: 'unavailable',
        message: 'Subtitle translation is not configured',
        endedAt: Date.now(),
      },
    };
  }

  if (await isCached(`${key}.vtt`)) {
    const job = jobs.get(key) ?? createJob(key);
    Object.assign(job, {
      status: 'ready',
      phase: 'ready',
      progress: 1,
      fileName: `${key}.vtt`,
      code: null,
      message: null,
    });
    jobs.set(key, job);
    return { job, work: null };
  }

  const existing = jobs.get(key);
  if (existing?.status === 'working') return { job: existing, work: null };

  // A job that failed is not retried on every request — a page reload should
  // not spend another hour of quota on a title that just said no.
  if (existing?.status === 'failed' && Date.now() - (existing.endedAt ?? 0) < RETRY_AFTER_MS) {
    return { job: existing, work: null };
  }

  const job = createJob(key);
  jobs.set(key, job);

  return { job, work: run(job, request) };
}

/**
 * The link to the original-language subtitle a title was translated from, or
 * null when there is not one.
 *
 * This is what puts an English track in the player's menu next to the Sorani
 * one. It cannot come from the job alone: a title translated days ago is served
 * straight out of the store, and there is no job behind a file — so on that
 * path the link has to be looked up on its own, which is the case this exists
 * for. It is searched with `findSource` rather than `fetchSourceSubtitle`
 * because only the URL is wanted; downloading the file would spend a second
 * request from the same quota for bytes nobody reads.
 *
 * Costs one search per title per instance, not one per page view: the promise
 * is kept in `links` and re-used, including when the answer is "there is none".
 *
 * @param {{key: string, status: string}} job  whatever the caller is answering about
 * @param {object} request  the title, as `prepareSubtitle`
 * @returns {Promise<string|null>} — never throws
 */
export async function sourceLink(job, request) {
  const known = links.get(job.key);
  if (known) return known;

  // A translation that is still looking for its source is about to record the
  // link itself. Searching here at the same moment would spend a second request
  // on the same answer, and the next poll reads the first one.
  if (job.status === 'working') return null;

  const search = findSource(request)
    .catch(() => findOpenSubtitle(request))
    .then((found) => found.url)
    .catch((error) => {
      // "No English subtitle exists for this title" is an answer, and a stable
      // one — remembering it stops every later viewer paying for the same miss.
      // A quota cap or a rejected key is a fact about this moment, not about the
      // title, so it is not kept and the next request tries again.
      if (!(error instanceof SubtitleError) || error.code !== 'not-found') {
        links.delete(job.key);
      }

      return null;
    });

  links.set(job.key, search);
  return search;
}

/** The current state of a job, or null when there is nothing for that key. */
export function getJob(key) {
  return jobs.get(key) ?? null;
}
