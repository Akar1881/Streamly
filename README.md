# Streamly

A movie and TV browser with Sorani Kurdish subtitles, running on your own
machine. Metadata comes from **TMDB**, playback is handed to a third-party
embed provider, and the app relays nothing — there is no server sitting between
you and the video.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](../../releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](../../releases/latest)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-555555?style=for-the-badge&logo=apple&logoColor=white)](../../releases/latest)

macOS builds are unsigned DMGs. On first launch, macOS may require you to
Control-click the app and choose **Open** to confirm you want to run it.

<img width="1920" height="941" alt="Streamly" src="https://github.com/user-attachments/assets/dcf5ad83-13a1-4234-8979-1b4c15c96dfb" />

## What it is

- Browse films and series, search, and keep a watchlist. No account, and
  nothing you do leaves the machine.
- Play through an embedded player, with a server switcher for when one source
  is down.
- Subtitles in Sorani, translated once and cached on your own disk.

It was a website first, and it is an app now for one reason: a website has to
relay every video through a server, and relaying is what gets rate-limited,
billed and blocked. Run locally there is nothing to relay.

## Install

Download the installer for your platform from the [latest release](../../releases/latest).

**Windows:** download `Streamly-Setup-<version>.exe` and run the installer.
Windows may display a SmartScreen warning because the installer is not code-signed.

**Linux:** download the `Streamly-<version>.AppImage`, then run:

```sh
chmod +x Streamly-*.AppImage
./Streamly-*.AppImage
```

On Arch there is also a `PKGBUILD` in [`desktop/arch`](desktop/arch) that wraps
the AppImage, so it installs with pacman and appears in your launcher.

**If it will not start**, FUSE is missing. Install `fuse2` (Arch:
`sudo pacman -S fuse2`), or unpack the image and run it from the directory:

```sh
./Streamly-*.AppImage --appimage-extract
./squashfs-root/AppRun
```

The first launch asks whether you want to add your own TMDB and Wyzie keys. It
is optional — the built-in keys work and skipping is fine — but your own are
faster, and not shared with anyone else.

The desktop app checks for updates on launch. Install the latest release
manually the first time; later updates can be downloaded and installed from the
in-app update prompt.

## Build it yourself

```sh
npm install
cp .env.example .env.local     # then fill in your keys
npm run dev                    # the web app, on http://localhost:3000
npm run desktop:run            # the same app in an Electron window
npm run desktop:pack           # release/Streamly-<version>.AppImage
npm run desktop:pack:win       # release/Streamly-Setup-<version>.exe
```

[.env.example](.env.example) lists every variable and where to get each key.
[desktop/README.md](desktop/README.md) covers the packaged app in more detail —
what goes wrong on an unfamiliar Linux, where it keeps your data, how to rebuild
the icon.

## Contributing

**Design only, please.** Artwork, the icon and logo, colour, type, spacing and
copy are all welcome — open an issue or a pull request and it will be looked
at.

Changes to how the app *works* — its features, its behaviour, the shape of its
code — are not being taken. Those pull requests will be closed without review,
not because the work is bad but because the direction is settled.

Read the [Code of Conduct](CODE_OF_CONDUCT.md) before you open anything. Taking
part means agreeing to it.

## Credits

Metadata from [TMDB](https://www.themoviedb.org/). This product uses the TMDB
API but is not endorsed or certified by TMDB.

Streamly hosts and stores no media. Playback is an embed from a third party,
which is responsible for its own content.
