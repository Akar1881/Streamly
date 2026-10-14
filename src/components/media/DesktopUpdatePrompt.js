'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Download, Sparkles, X } from 'lucide-react';

const RELEASE_URL = 'https://github.com/Akar1881/Streamly/releases/tag/latest';
const API_URL = 'https://api.github.com/repos/Akar1881/Streamly';

export default function DesktopUpdatePrompt() {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get('previewUpdate') === '1';
    if (preview) {
      setUpdate({ sha: 'preview' });
      return undefined;
    }

    if (process.env.NEXT_PUBLIC_STREAMLY_DESKTOP !== '1') return undefined;

    const buildSha = process.env.NEXT_PUBLIC_STREAMLY_BUILD_SHA;
    if (!buildSha || buildSha === 'unknown') return undefined;

    const controller = new AbortController();

    async function checkForUpdate() {
      try {
        const tagResponse = await fetch(`${API_URL}/git/ref/tags/latest`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!tagResponse.ok) return;

        const tag = await tagResponse.json();
        const latestSha = tag.object?.type === 'commit' ? tag.object.sha : null;
        if (!latestSha || latestSha === buildSha) return;

        const compareResponse = await fetch(
          `${API_URL}/compare/${buildSha}...${latestSha}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!compareResponse.ok) return;

        const comparison = await compareResponse.json();
        if (comparison.status !== 'ahead' || comparison.ahead_by < 1) return;

        setUpdate({ sha: latestSha });
      } catch {
        // Update checks are best-effort and must never block app startup.
      }
    }

    checkForUpdate();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!update) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') dismissUpdate();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [update]);

  function dismissUpdate() {
    setUpdate(null);
  }

  if (!update) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-md sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismissUpdate();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-update-title"
        className="grid max-h-[calc(100dvh-1.5rem)] w-full max-w-[54rem] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-2xl sm:max-h-[min(36rem,calc(100dvh-3rem))] sm:grid-cols-[0.88fr_1.12fr] sm:grid-rows-1"
      >
        <div className="hidden flex-col justify-between bg-accent p-8 text-accent-text sm:flex sm:p-10">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
            <Sparkles size={16} aria-hidden="true" />
            Streamly desktop
          </div>
          <div className="py-8">
            <div className="mb-7 grid size-20 place-items-center rounded-2xl border border-accent-text/20 bg-accent-text/10">
              <Download size={34} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <p className="max-w-xs text-3xl font-semibold leading-tight">
              Your next watch starts with the latest build.
            </p>
          </div>
          <p className="text-sm text-accent-text/75">A fresh Streamly update is ready.</p>
        </div>

        <div className="flex min-h-0 flex-col overflow-y-auto p-5 sm:p-9">
          <div className="mb-7 flex items-center justify-between sm:mb-10">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:hidden">
              <Sparkles size={15} aria-hidden="true" />
              Streamly update
            </div>
            <span className="hidden text-xs font-medium uppercase tracking-[0.1em] text-muted sm:block">
              Update available
            </span>
            <button
              type="button"
              onClick={dismissUpdate}
              aria-label="Remind me later"
              className="ml-auto grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-card hover:text-text"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="my-auto">
            <h2
              id="desktop-update-title"
              className="max-w-md text-2xl font-semibold leading-tight text-text sm:text-4xl"
            >
              A newer version is ready.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted sm:mt-5 sm:text-base sm:leading-7">
              Get the latest Streamly desktop build from GitHub. Your library and settings stay on this device.
            </p>
          </div>

          <div className="mt-8 flex flex-col-reverse gap-3 sm:mt-10 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={dismissUpdate}
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-button)] px-4 text-sm font-medium text-muted transition-colors hover:bg-card hover:text-text"
            >
              Remind me later
            </button>
            <a
              href={RELEASE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-button)] bg-accent px-5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90"
            >
              Update now
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}