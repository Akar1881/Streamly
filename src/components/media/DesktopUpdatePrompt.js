'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowUpRight, Check, LoaderCircle, Sparkles, X } from 'lucide-react';

const RELEASE_URL = 'https://github.com/Akar1881/Streamly/releases/tag/latest';

export default function DesktopUpdatePrompt() {
  const [update, setUpdate] = useState(null);
  const [dismissedVersion, setDismissedVersion] = useState(null);

  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get('previewUpdate') === '1';
    if (preview) {
      setUpdate({ status: 'available', version: '0.1.1', preview: true });
      return undefined;
    }

    const updater = window.streamlyUpdater;
    if (!updater) return undefined;

    let active = true;
    function applyState(nextState) {
      if (!active) return;
      if (!nextState || ['idle', 'checking', 'current'].includes(nextState.status)) {
        setUpdate(null);
        return;
      }
      if (nextState.version && nextState.version === dismissedVersion) return;
      setUpdate(nextState);
    }

    const unsubscribe = updater.onState(applyState);
    updater.getState().then(applyState).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [dismissedVersion]);

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
    if (update?.version) setDismissedVersion(update.version);
    setUpdate(null);
  }

  async function handlePrimaryAction() {
    if (update.preview) {
      window.open(RELEASE_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    if (update.status === 'downloaded') {
      await window.streamlyUpdater?.install();
      return;
    }
    await window.streamlyUpdater?.download();
  }

  if (!update) return null;

  const downloading = update.status === 'downloading';
  const downloaded = update.status === 'downloaded';
  const failed = update.status === 'error';
  const percent = Math.max(0, Math.min(100, update.percent ?? 0));
  const heading = downloaded
    ? 'Your update is ready to install.'
    : downloading
      ? 'Downloading the latest version.'
      : failed
        ? 'The update could not finish.'
        : 'A newer version is ready.';

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
              {downloaded ? (
                <Check size={34} strokeWidth={1.6} aria-hidden="true" />
              ) : downloading ? (
                <LoaderCircle size={34} strokeWidth={1.6} className="animate-spin" aria-hidden="true" />
              ) : (
                <ArrowDownToLine size={34} strokeWidth={1.6} aria-hidden="true" />
              )}
            </div>
            <p className="max-w-xs text-3xl font-semibold leading-tight">
              {downloaded ? 'The latest build is ready.' : 'Your next watch starts with the latest build.'}
            </p>
          </div>
          <p className="text-sm text-accent-text/75">
            {downloading ? `Downloading ${percent}%` : 'A fresh Streamly update is ready.'}
          </p>
        </div>

        <div className="flex min-h-0 flex-col overflow-y-auto p-5 sm:p-9">
          <div className="mb-7 flex items-center justify-between sm:mb-10">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:hidden">
              <Sparkles size={15} aria-hidden="true" />
              Streamly update
            </div>
            <span className="hidden text-xs font-medium uppercase tracking-[0.1em] text-muted sm:block">
              {downloaded ? 'Ready to install' : downloading ? 'Downloading update' : 'Update available'}
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
              {heading}
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted sm:mt-5 sm:text-base sm:leading-7">
              {downloaded
                ? `Streamly ${update.version} has downloaded. Restart the app to install it.`
                : downloading
                  ? `Downloading Streamly ${update.version}. You can keep using the app while it finishes.`
                  : failed
                    ? 'Check your connection and try again, or download the latest installer from GitHub.'
                    : `Streamly ${update.version} is available. Download it now; your library and settings stay on this device.`}
            </p>
            {downloading && (
              <div
                className="mt-6 h-2 overflow-hidden rounded-full bg-card"
                role="progressbar"
                aria-label="Update download progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
            )}
            {failed && (
              <a
                href={RELEASE_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                Open GitHub release
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            )}
          </div>

          <div className="mt-8 flex flex-col-reverse gap-3 sm:mt-10 sm:flex-row sm:items-center">
            {!downloading && !downloaded && (
              <button
                type="button"
                onClick={dismissUpdate}
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius-button)] px-4 text-sm font-medium text-muted transition-colors hover:bg-card hover:text-text"
              >
                Remind me later
              </button>
            )}
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={downloading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-button)] bg-accent px-5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
            >
              {downloading ? (
                <><LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> Downloading {percent}%</>
              ) : downloaded ? (
                <>Restart and install <Check size={16} aria-hidden="true" /></>
              ) : update.preview ? (
                <>Update now <ArrowUpRight size={16} aria-hidden="true" /></>
              ) : failed ? (
                <>Try download again <ArrowDownToLine size={16} aria-hidden="true" /></>
              ) : (
                <>Download update <ArrowDownToLine size={16} aria-hidden="true" /></>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}