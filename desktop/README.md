# Streamly for the desktop

An Electron window around the same Next app the website is, running on the
machine you are sitting at. The shell is [main.cjs](main.cjs); everything else
here is packaging.

## Why this exists

The deployed site relays video through a serverless function, which is what a
Hobby plan meters and eventually refuses. Running locally removes the whole
problem: there is no server between the viewer and the video, the address the
stream URL was signed for is the address watching it, and translated subtitles
are written to a disk that is still there on the next launch.

## Running it

```sh
npm install          # once — pulls Electron, which is ~100 MB
npm run desktop:run  # build, then open the window
```

`desktop:run` builds first every time. For iterating on the app itself,
`npm run dev` in a browser is far quicker and exercises all of the same code;
the shell only matters for things that are true of a packaged app, which is
mostly the data directory and the first-run screen.

## Building an AppImage

```sh
npm run desktop:pack
```

That writes `release/Streamly-0.1.0.AppImage` — about 134 MB, almost all of it
the browser and the Node runtime it carries. Run it directly:

```sh
./release/Streamly-0.1.0.AppImage
```

### If it will not start

**FUSE is missing.** The AppImage mounts itself through it, so without `fuse2`
there is nothing to run. Install it (Arch: `sudo pacman -S fuse2`), or unpack
the image once and start the app from the directory instead:

```sh
./release/Streamly-0.1.0.AppImage --appimage-extract
./squashfs-root/AppRun
```

`AppRun` rather than `squashfs-root/streamly`: the latter is the Electron binary
on its own, without the environment `AppRun` sets up around it.

### About the sandbox

The app runs with `--no-sandbox`, and that is not an oversight to correct.
`chrome-sandbox` inside the AppImage is mode `755` rather than setuid root, so
Chromium's setuid sandbox cannot start; electron-builder puts the flag in the
desktop entry it generates so that launching from a menu works regardless.

The consequence is that the renderer is unsandboxed. For an app whose entire
content is our own page on loopback that is a smaller concession than it
sounds, but it is a real one and worth knowing rather than discovering. If you
would rather have the sandbox, install `chrome-sandbox` setuid root and drop the
flag from the entry — nothing here does that for you.

## Installing it as a package

`PKGBUILD` in [arch/](arch/) wraps the AppImage in a pacman package, which also
installs the icon and a desktop entry so it appears in a launcher:

```sh
cd desktop/arch
makepkg -si
```

It builds from the AppImage that `npm run desktop:pack` has already produced, so
run that first. See the comments at the top of the PKGBUILD for the version
you have to keep in step.

## Where it keeps things

Everything is under Electron's per-user directory, which on Linux is
`~/.config/streamly` — lowercase, because Electron derives it from the `name`
in `package.json` rather than from the `productName` the packer uses:

| Path | What |
| --- | --- |
| `settings.json` | the keys you added, mode `0600` |
| `subtitles/` | translations, cached by title and language |

Deleting the directory resets the app completely — it will open the first-run
screen again, on the built-in keys, and re-download any subtitles it needs.

## The built-in keys

The first-run screen offers a choice: paste your own keys, or use the ones
Streamly ships with. That second option only works if the keys are actually
*in* the build, and by default they are not — `next build` does not copy
`.env.local` into the standalone bundle, so the server inside the app starts
with an empty environment.

`npm run desktop:build` therefore begins by reading `.env.local` (and `.env`,
and the shell's own environment) and writing
[builtin-keys.json](builtin-keys.json), which `src/lib/settings.js` reads as the
last tier of its lookup. That file is gitignored and rewritten on every build,
so a rotated key cannot survive as a stale one.

If the build warns that a key is missing, the app still builds and runs — but a
viewer who skips the first-run screen will have nothing behind that choice, and
nothing on screen will say so. Fill in `.env.local` and build again.

**Anyone who has the AppImage can read those keys out of it.** That is the
accepted trade for the app working out of the box; it is the same exposure a
browser extension with a bundled key has.

## The icon

[resources/icon.svg](resources/icon.svg) is the source; `resources/icon.png` is
what gets packed, and is generated from it:

```sh
cd desktop/resources && rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png
```

electron-builder picks up `icon.png` from `resources/` without being told where
it is. It has to be a raster: the packer needs several sizes and does not read
SVG.

## What is not here yet

**Windows.** `main.cjs` is platform-neutral and the builder config only needs
`--win` added to `desktop:pack`, but nobody has run it. It should be a
one-evening job rather than a rewrite.

**Android.** A different problem — no Electron, and a Node runtime that has to
be shipped as a library (`nodejs-mobile`) because an app cannot execute anything
from inside its own bundle. Feasible; unrelated to this directory.

**Update checks.** The desktop app checks GitHub's `latest` tag on launch and
offers a link when that tag points to a newer commit. It does not download or
install updates itself; download the new AppImage from the update page.
