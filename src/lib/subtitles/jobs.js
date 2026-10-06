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
import { parseSubtitle, toVtt } from './srt';
import { translateCues, translateKey } from './translate';
import { fetchSourceSubtitle, wyzieKey } from './wyzie';

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
      "viewer's browser. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and " +
      'R2_BUCKET — see .env.example.',
  );
}

/** job key → job record. Finished jobs are kept briefly so late polls resolve. */
const jobs = new Map();

/** How many finished jobs to remember before the oldest are dropped. */
const MAX_JOBS = 200;

/** How long a failed job is served before a new request may retry it. */
const RETRY_AFTER_MS = 60_000;

/** True when the feature has everything it needs to run. */
export function subtitlesEnabled() {
  return Boolean(site.subtitles.enabled && wyzieKey() && translateKey());
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
    const source = await fetchSourceSubtitle(request);

    const cues = parseSubtitle(source.vtt);
    if (!cues.length) {
      throw new SubtitleError('The source subtitle had no readable cues', 'fetch-failed');
    }

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

/** The current state of a job, or null when there is nothing for that key. */
export function getJob(key) {
  return jobs.get(key) ?? null;
}
