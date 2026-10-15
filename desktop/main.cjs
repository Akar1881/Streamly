/**
 * ============================================================================
 *  STREAMLY FOR THE DESKTOP
 * ============================================================================
 *
 *  An Electron window around the same Next app the website is, running on the
 *  machine you are sitting at. Nothing about the app changes here; what changes
 *  is where it runs, and that turns out to be most of the point:
 *
 *    - There is no server between the viewer and the video, so there is nothing
 *      to pay for and no egress to be blocked over.
 *    - The address the player asks for a stream from is the address watching it,
 *      which is the condition a signed stream URL is usually checking for.
 *    - Subtitles are translated once and kept on this disk — `disk.js` stops
 *      being the development fallback and becomes the real backend, because the
 *      process that writes a file is the process that later serves it.
 *    - The keys can be the viewer's own, stored in their own directory. See
 *      `src/lib/settings.js`.
 *
 *  ---------------------------------------------------------------------------
 *  How the server is started, and why it is started this way
 *  ---------------------------------------------------------------------------
 *
 *  Electron's main process *is* Node. So instead of shipping a Node runtime
 *  beside the app and running it as a sidecar, this file `require`s the bundle
 *  `next build` emits for exactly this purpose — `.next/standalone/server.js` —
 *  and gets a listening server in the same process as the window.
 *
 *  That is the whole reason Electron is the easier of the two Linux options
 *  here. Tauri would need a pinned Node binary shipped as a sidecar, and it
 *  renders through WebKitGTK, whose Media Source Extensions support is the one
 *  thing hls.js cannot do without. Electron renders Chromium and already has
 *  Node in it.
 *
 *  Environment is set *before* the server is required, because Next reads
 *  `NODE_ENV` at import time and the settings module reads `STREAMLY_DESKTOP`
 *  on the first request. Both are set below, above the `require`.
 *
 *  If the server ever misbehaves inside Electron's main process — it is an
 *  ordinary Node program, and it has not been seen to — the fix is Electron's
 *  `utilityProcess.fork`, which runs the same bundle in a child process using
 *  the same Node. That is a move of one `require` into a four-line launcher,
 *  not a redesign.
 *
 *  ---------------------------------------------------------------------------
 *  What this file does not do
 *  ---------------------------------------------------------------------------
 *
 *  It does not sandbox the page beyond Electron's defaults, and it does not
 *  open developer tooling. The page is our own, served from loopback, and the
 *  only code it runs is code we shipped.
 * ============================================================================
 */

'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

/** The packaged app's root — the directory holding `.next` and `desktop`. */
const ROOT = path.join(__dirname, '..');

const SERVER = path.join(ROOT, '.next', 'standalone', 'server.js');

/**
 * The loopback address, spelled out rather than as `localhost`.
 *
 * `localhost` resolves through the system resolver, which on a machine with a
 * hosts file or an mDNS daemon can answer with `::1` first — and the server
 * binds IPv4. The failure mode is a window that never loads and no error.
 */
const HOST = '127.0.0.1';

/** A stable origin is required: Chromium localStorage is partitioned by port. */
const PORT = 43127;

/** How long the window waits for the server before giving up and saying so. */
const STARTUP_TIMEOUT_MS = 30_000;
const UPDATE_STATE_CHANNEL = 'streamly-update:state';

let updateState = { status: 'idle' };
let updateHandlersRegistered = false;

function publishUpdateState(nextState) {
  updateState = nextState;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(UPDATE_STATE_CHANNEL, updateState);
  }
}

/** Configure updates for the packaged Linux AppImage and Windows NSIS builds. */
function configureUpdater() {
  const supportedTarget =
    (process.platform === 'linux' && Boolean(process.env.APPIMAGE)) ||
    process.platform === 'win32';
  if (!app.isPackaged || !supportedTarget) {
    return false;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    publishUpdateState({ status: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    publishUpdateState({ status: 'current' });
  });
  autoUpdater.on('download-progress', (progress) => {
    publishUpdateState({
      status: 'downloading',
      version: updateState.version,
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    publishUpdateState({ status: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (cause) => {
    if (['available', 'downloading'].includes(updateState.status)) {
      publishUpdateState({
        status: 'error',
        version: updateState.version,
        message: String(cause?.message ?? cause),
      });
    } else {
      console.warn('[updater] Update check failed:', cause);
    }
  });

  if (!updateHandlersRegistered) {
    ipcMain.handle('streamly-update:get-state', () => updateState);
    ipcMain.handle('streamly-update:download', async () => {
      if (!['available', 'error'].includes(updateState.status)) return false;
      const version = updateState.version;
      publishUpdateState({ status: 'downloading', version, percent: 0 });
      try {
        await autoUpdater.downloadUpdate();
        return true;
      } catch (cause) {
        publishUpdateState({
          status: 'error',
          version,
          message: String(cause?.message ?? cause),
        });
        return false;
      }
    });
    ipcMain.handle('streamly-update:install', () => {
      if (updateState.status !== 'downloaded') return false;
      autoUpdater.quitAndInstall(false, true);
      return true;
    });
    updateHandlersRegistered = true;
  }

  return true;
}

/** Check the stable app port before starting Next, without taking it over. */
function canUsePort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, HOST, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Resolves once something is listening on `port`.
 *
 * A TCP connect rather than an HTTP request: what is being waited for is a
 * socket, and a connect answers that without needing to know what the server
 * says back — which at this point in the startup is nothing it has decided yet.
 */
async function waitForPort(port, timeoutMs) {
  const until = Date.now() + timeoutMs;

  while (Date.now() < until) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ port, host: HOST });
      const done = (result) => {
        socket.destroy();
        resolve(result);
      };

      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(1_000, () => done(false));
    });

    if (open) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return false;
}

/**
 * Whether the viewer has been through the first-run screen.
 *
 * Read straight from the file rather than asked over HTTP, because the answer
 * decides which URL the window opens on — and asking would mean starting the
 * server before knowing where to point it at, for a question that is one read.
 * The path is the same one `src/lib/settings.js` writes to; both are
 * `STREAMLY_DATA_DIR`, which is set below.
 */
function needsSetup() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8');
    return JSON.parse(raw)?.onboarded !== true;
  } catch {
    // No file, or one somebody has broken. Either way: ask.
    return true;
  }
}

function createWindow(base) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 880,
    minHeight: 560,

    /**
     * The page paints its own background, but not until React has hydrated.
     * Without this the window is white for that moment, which is the one flash
     * a dark-themed app is not allowed to have. The value is `theme.colors.dark.bg`
     * from `config/site.js` — hardcoded because this file is CommonJS and runs
     * outside the bundle, and a stale hex here is a slightly wrong flash rather
     * than anything that breaks.
     */
    backgroundColor: '#0a0a0a',

    // The default menu holds Reload and the developer tools; it is worth
    // keeping, and worth keeping out of the way until Alt is pressed.
    autoHideMenuBar: true,

    // Shown on `ready-to-show` instead, so the window appears fully drawn.
    show: false,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),

      /**
       * A video is the one thing that should not be paused because the viewer
       * clicked another window. Chromium throttles background pages by default,
       * which reaches the player through its timers and, on a long enough
       * stretch, its buffers.
       */
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  /**
   * Links out of the app open in the real browser.
   *
   * The footer's social link, TMDB's API page in the settings help text — all
   * of them are things the viewer expects to land in a browser with their own
   * session, and none of them belong in a chrome-less window they cannot
   * navigate back from.
   */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(base)) return { action: 'allow' };
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  /**
   * And so does anything that navigates the window itself somewhere else.
   *
   * Nothing in the app does, so this catches the cases that are not the app:
   * a click that got past the handler above, a redirect. The player is
   * unaffected — it fetches cross-origin media constantly, and that is a
   * request rather than a navigation.
   */
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(base)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });

  win.loadURL(needsSetup() ? `${base}/welcome` : `${base}/`);
}

async function main() {
  if (!fs.existsSync(SERVER)) {
    dialog.showErrorBox(
      'Streamly has not been built yet',
      `There is no server bundle at:\n${SERVER}\n\n` +
        'Run "npm run desktop:build" first — it builds the app in the form this ' +
        'shell needs, and copies the static assets into place.',
    );
    app.exit(1);
    return;
  }

  /**
   * Everything the server needs to know, set before it is loaded.
   *
   * `STREAMLY_DATA_DIR` and `SUBTITLE_CACHE_DIR` both point inside Electron's
   * per-user directory — `~/.config/Streamly` on Linux, derived from the app
   * name rather than hardcoded, so an uninstall and a reinstall land on the
   * same key file rather than two.
   */
  const dataDir = app.getPath('userData');
  const port = PORT;

  if (!(await canUsePort(port))) {
    dialog.showErrorBox(
      'Streamly could not start',
      `The local port ${port} is already in use. Close the other app using it and ` +
        'try again. Streamly needs this fixed port to keep your saved watch ' +
        'progress and settings available between launches.',
    );
    app.exit(1);
    return;
  }

  process.env.NODE_ENV = 'production';
  process.env.PORT = String(port);
  process.env.HOSTNAME = HOST;
  process.env.STREAMLY_DESKTOP = '1';
  process.env.STREAMLY_DATA_DIR = dataDir;
  process.env.SUBTITLE_CACHE_DIR = path.join(dataDir, 'subtitles');

  /**
   * The keys the build shipped with.
   *
   * `next build` does not carry `.env.local` into the standalone bundle, so the
   * server inside this window starts with an empty environment and would have
   * no TMDB account at all. `scripts/desktop-keys.mjs` writes what it found to
   * this file, which is where `src/lib/settings.js` looks when neither the
   * viewer nor the environment has supplied a key.
   *
   * Naming it even when it is missing: the file is generated, a build made
   * without `.env.local` will not have it, and the module treats an unreadable
   * path the same as an absent one rather than failing.
   */
  process.env.STREAMLY_BUILTIN_KEYS = path.join(ROOT, 'desktop', 'builtin-keys.json');

  /**
   * The server resolves its own files against the working directory — the
   * `public` folder and the `.next` directory it was built into — so it has to
   * be started from beside them rather than from wherever Electron happened to
   * be launched.
   */
  process.chdir(path.join(ROOT, '.next', 'standalone'));

  try {
    require(SERVER);
  } catch (cause) {
    dialog.showErrorBox('Streamly could not start', String(cause?.stack ?? cause));
    app.exit(1);
    return;
  }

  const base = `http://${HOST}:${port}`;

  if (!(await waitForPort(port, STARTUP_TIMEOUT_MS))) {
    dialog.showErrorBox(
      'Streamly could not start',
      `The app's own server did not begin listening on ${base} within ` +
        `${STARTUP_TIMEOUT_MS / 1000} seconds.`,
    );
    app.exit(1);
    return;
  }

  const canUpdate = configureUpdater();
  createWindow(base);
  if (canUpdate) {
    autoUpdater.checkForUpdates().catch((cause) => {
      console.warn('[updater] Update check failed:', cause);
    });
  }
}

/**
 * One copy at a time.
 *
 * A second launch focuses the window that already exists rather than starting a
 * second server on a second port, writing to the same subtitle cache. The lock
 * has to be taken before the window exists, which is why it is out here.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(main);

  app.on('window-all-closed', () => {
    // The server lives in this process, so quitting is also what stops it.
    app.quit();
  });
}
