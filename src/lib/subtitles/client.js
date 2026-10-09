'use client';

import { useEffect, useRef, useState } from 'react';
import site from '@config/site';

/**
 * ============================================================================
 *  SUBTITLE PREPARATION — client side
 * ============================================================================
 *
 *  Drives the waiting screen: starts the server job, then polls it until the
 *  subtitle is ready, the job failed, or we have waited long enough.
 *
 *  The waiting screen is the whole reason this is a hook rather than a plain
 *  fetch — a translation is not instant, and "something is happening, here is
 *  what" needs phases to show. It is also the reason every ending here is a
 *  normal one: this hook never throws, and never leaves the caller without an
 *  answer. The player loads in all of them.
 * ============================================================================
 */

/** How often to ask the server where it is. */
const POLL_MS = 900;

/** Consecutive failed polls before we stop trying. */
const MAX_POLL_FAILURES = 3;

/** The state the hook starts in. */
const WORKING = { status: 'working', phase: 'searching', progress: 0 };

/**
 * Prepares the translated subtitle for a title.
 *
 * @param {object} request
 * @param {'movie'|'tv'} request.mediaType
 * @param {number} request.tmdbId
 * @param {number} [request.season]
 * @param {number} [request.episode]
 * @param {string|null} [request.sourceUrl]
 *        the playing provider's own subtitle, when it has one. Sent with the
 *        start request only — the job is stored per title, so a poll has nothing
 *        to add and a later poll would otherwise claim a different source for a
 *        translation already made.
 * @param {boolean} [request.providerSettled]
 *        whether the providers have finished answering for this title. Nothing
 *        starts until they have, and that is the point of it: the translation
 *        has to be made from the provider's subtitle when there is one, and
 *        before the providers answer nobody knows whether there is one. Starting
 *        early meant always translating Wyzie's copy and then discarding it —
 *        which is also what the viewer waited through the progress screen for.
 * @returns {{
 *   status: 'off'|'working'|'ready'|'failed',
 *   phase: string,
 *   progress: number,
 *   url: string|null,
 *   sourceUrl: string|null,
 *   code: string|null,
 *   label: string,
 *   resetAt: string|null,
 * }}
 */
export function useTranslatedSubtitle({
  mediaType,
  tmdbId,
  season,
  episode,
  sourceUrl = null,
  providerSettled = true,
}) {
  const enabled = Boolean(site.subtitles.enabled);

  const [state, setState] = useState(enabled ? WORKING : { status: 'off' });

  // Keeps the effect from writing state after the component is gone.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !tmdbId || !providerSettled) return undefined;

    const controller = new AbortController();
    const query = { mediaType, tmdbId, ...(season && episode ? { season, episode } : {}) };
    const deadline = Date.now() + site.subtitles.waitMs;

    /**
     * Stops polling and reports where we got to.
     *
     * `sourceUrl` survives the ending. The local-settle paths below are endings
     * this hook decided on — a timeout, a dropped connection — and the original
     * language track was already known before the translation stalled. Losing it
     * here would take the English subtitle away at exactly the moment the Sorani
     * one failed, which is when a viewer most wants the alternative.
     */
    const settle = (next) => {
      if (!alive.current) return;
      setState((previous) => ({
        ...next,
        sourceUrl: next.sourceUrl ?? previous?.sourceUrl ?? null,
      }));
    };

    /**
     * Records a poll result, never letting progress go backwards.
     *
     * The jobs map lives in one server instance's memory, so a poll can land
     * on an instance that knows nothing about this job and honestly reports
     * zero. A bar that drops from 62% to 0% reads as a fault rather than a
     * wait, and the viewer has no way to tell the difference — so the furthest
     * we have seen is what we show.
     */
    const advance = (next) => {
      if (!alive.current) return;
      setState((previous) => ({
        ...next,
        progress: Math.max(previous?.progress ?? 0, next.progress ?? 0),
      }));
    };

    async function prepare() {
      try {
        const response = await fetch('/api/subtitles/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sourceUrl ? { ...query, sourceUrl } : query),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`Prepare failed (${response.status})`);

        let status = await response.json();
        if (!alive.current) return;

        advance(status);

        // The job is done, or it never started — either way, stop.
        if (status.status !== 'working') return;

        const poll = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
        let failures = 0;

        while (Date.now() < deadline) {
          // Throttled by the deadline: a slow poll delays the next, which is
          // what we want when the server is struggling.
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (!alive.current) return;

          if (Date.now() >= deadline) break;

          try {
            const next = await fetch(`/api/subtitles/prepare?${poll}`, {
              signal: controller.signal,
            });

            if (!next.ok) throw new Error(`Poll failed (${next.status})`);

            status = await next.json();
            failures = 0;

            if (!alive.current) return;
            advance(status);

            if (status.status !== 'working') return;
          } catch (error) {
            // A dropped connection mid-translation is not a verdict on the
            // subtitle; a few of them in a row is.
            if (error?.name === 'AbortError') return;
            failures += 1;
            if (failures >= MAX_POLL_FAILURES) {
              settle({
                status: 'failed',
                phase: 'failed',
                progress: 0,
                code: 'fetch-failed',
                message: 'Lost contact while translating',
                label: site.subtitles.target.label,
              });
              return;
            }
          }
        }

        // Out of patience. The job is still running on the server and will be
        // cached for the next viewer, so this viewer simply plays now.
        settle({
          status: 'failed',
          phase: 'failed',
          progress: 0,
          code: 'timeout',
          message: 'Translation took too long',
          label: site.subtitles.target.label,
        });
      } catch (error) {
        if (error?.name === 'AbortError' || !alive.current) return;

        settle({
          status: 'failed',
          phase: 'failed',
          progress: 0,
          code: 'fetch-failed',
          message: error?.message ?? 'Could not prepare subtitles',
          label: site.subtitles.target.label,
        });
      }
    }

    setState(WORKING);
    prepare();

    return () => controller.abort();
  }, [enabled, mediaType, tmdbId, season, episode, sourceUrl, providerSettled]);

  return state;
}
