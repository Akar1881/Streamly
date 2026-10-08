import { after, NextResponse } from 'next/server';
import site from '@config/site';
import { cacheKey, isCached, publicUrl } from '@/lib/subtitles/cache';
import { getJob, prepareSubtitle, sourceLink } from '@/lib/subtitles/jobs';

/**
 * ============================================================================
 *  SUBTITLE PREPARATION
 * ============================================================================
 *
 *  The waiting screen's two calls:
 *
 *    POST /api/subtitles/prepare   { mediaType, tmdbId, season?, episode? }
 *      → starts the job, or joins the one already running for that title,
 *        or answers straight from the store. Returns the first status.
 *
 *    GET  /api/subtitles/prepare?mediaType=…&tmdbId=…
 *      → the same status object, polled until it is `ready` or `failed`.
 *
 *  The response is always 200 with a `status`, including when the whole thing
 *  failed: the player must load either way, so a failure is a fact about the
 *  subtitle rather than an error in the request. The client only branches on
 *  `status` and `code`.
 *
 *  Node.js runtime — the pipeline talks to the subtitle service and the
 *  translator, and the store is object storage or the filesystem.
 * ============================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How long the platform is asked to keep this invocation alive.
 *
 * Translating a feature film is twenty-odd requests to the translator, so the
 * work has to survive the response that started it — `after()` below is what
 * arranges that, and this is what it is allowed to take. It is also the real
 * ceiling on `subtitles.timeoutMs`: past it the platform kills the invocation,
 * and a translation that cannot finish inside it is never stored at all.
 */
export const maxDuration = 60;

/** Nothing here is cacheable — the status is the whole point. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/** The absolute base a viewer's browser can reach this app on. */
function viewerBase(request) {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || request.nextUrl.origin;
}

/**
 * The URL the player should fetch the subtitle from.
 *
 * It has to be reachable from the *viewer's* browser, because the player
 * downloads the track itself — not from us. Object storage answers that
 * properly: one URL, the same on every instance, that outlives the request
 * which created it. Without a store, the file is served from this app, and a
 * configured site URL is the correct base; falling back to the request's own
 * origin keeps `next dev` working with nothing configured.
 */
async function subtitleUrl(request, fileName) {
  const direct = await publicUrl(fileName);
  if (direct) return direct;

  try {
    return new URL(`/api/subtitles/${fileName}`, viewerBase(request)).toString();
  } catch {
    return new URL(`/api/subtitles/${fileName}`, request.nextUrl.origin).toString();
  }
}

/**
 * The client-facing view of a job.
 *
 * `sourceUrl` is the original-language subtitle, as the source's own link — the
 * same file the translation was made from, and what the player offers as the
 * English track. It is asked for on every response rather than read off the
 * job, because most responses have no job behind them at all: a title that was
 * translated once and has been served out of the store ever since still has an
 * English subtitle, and the viewer should still get it. `sourceLink` looks it up
 * on that path, and answers from its own memory on every path after the first.
 *
 * It is offered even when the job has failed or timed out. The link was found
 * before the translation started, so an English track is available regardless of
 * how the Sorani one turned out.
 */
async function toResponse(request, job, target) {
  return NextResponse.json(
    {
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      code: job.code,
      message: job.message,
      resetAt: job.resetAt,
      key: job.key,
      /** What the waiting screen calls the subtitle it is preparing. */
      label: site.subtitles.target.label,
      url: job.fileName ? await subtitleUrl(request, job.fileName) : null,
      sourceUrl: await sourceLink(job, target),
    },
    { headers: NO_STORE },
  );
}

/** Reads the title out of a request, or explains why it cannot. */
function readTarget(source) {
  const mediaType = source.mediaType === 'tv' ? 'tv' : source.mediaType === 'movie' ? 'movie' : null;
  const tmdbId = Number(source.tmdbId);

  if (!mediaType || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    return { error: 'mediaType must be "movie" or "tv", and tmdbId a positive integer' };
  }

  if (mediaType === 'tv') {
    const season = Number(source.season);
    const episode = Number(source.episode);

    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode <= 0) {
      return { error: 'A TV episode needs integer season and episode numbers' };
    }

    return { target: { mediaType, tmdbId, season, episode } };
  }

  return { target: { mediaType, tmdbId } };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400, headers: NO_STORE });
  }

  const { target, error } = readTarget(body ?? {});
  if (error) return NextResponse.json({ error }, { status: 400, headers: NO_STORE });

  // Deliberately not awaited: `prepareSubtitle` answers as soon as the job
  // exists, and the work carries on behind it. `after` is what lets it carry
  // on at all on a serverless host — without it the invocation would be frozen
  // the moment this response is sent, halfway through a translation.
  const { job, work } = await prepareSubtitle(target);
  if (work) after(work.catch(() => {}));

  return toResponse(request, job, target);
}

export async function GET(request) {
  const { target, error } = readTarget(Object.fromEntries(request.nextUrl.searchParams));
  if (error) return NextResponse.json({ error }, { status: 400, headers: NO_STORE });

  const job = getJob(cacheKey(target));
  if (job) return toResponse(request, job, target);

  // No job *on this instance*. The jobs map lives in memory, so on a host that
  // runs several of them — which is every serverless host — the poll that
  // asked this question may simply have landed somewhere that never saw the
  // job, while another instance is translating it right now.
  //
  // So ask the store instead, which every instance can see: a file there is a
  // finished translation, and the answer is `ready` no matter which instance
  // produced it. That is the check that makes the whole design work across
  // instances, and it is why the store has to be shared storage.
  const fileName = `${cacheKey(target)}.vtt`;
  if (await isCached(fileName)) {
    return toResponse(
      request,
      {
        status: 'ready',
        phase: 'ready',
        progress: 1,
        code: null,
        message: null,
        resetAt: null,
        key: cacheKey(target),
        fileName,
      },
      target,
    );
  }

  // Nothing stored and no local job. Either another instance is still working,
  // or the job died with an instance that has since been recycled — and from
  // here those look identical.
  //
  // `working` is the honest answer to that, because the second case is rare and
  // reporting `failed` would tell the viewer subtitles are unavailable while a
  // translation is in fact about to land. The client has its own deadline, so
  // waiting cannot go on forever.
  return NextResponse.json(
    {
      status: 'working',
      phase: 'translating',
      progress: 0,
      code: null,
      message: null,
      resetAt: null,
      key: cacheKey(target),
      label: site.subtitles.target.label,
      url: null,
      // Left null rather than looked up: the job that would know it is on
      // another instance, and searching for it here would spend one of the key's
      // requests answering a question that instance is already answering. If the
      // translation is real, the poll that reports `ready` carries the link.
      sourceUrl: null,
    },
    { headers: NO_STORE },
  );
}
