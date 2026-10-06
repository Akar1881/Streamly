# Streamly

A movie and TV browsing site built with Next.js. Metadata comes from **TMDB**;
playback is handed off to a **third-party embed provider**. There are no user
accounts anywhere in the app.

---

<img width="1920" height="941" alt="image" src="https://github.com/user-attachments/assets/dcf5ad83-13a1-4234-8979-1b4c15c96dfb" />

## Quick start

```bash
npm install
cp .env.example .env.local      # then paste your TMDB key into it
npm run dev                     # http://localhost:3000
```

### Getting a TMDB key (free)

1. Create an account at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to **Settings → API** and request a key (choose "Developer", personal use).
3. Copy the **API Key (v3 auth)** value into `.env.local`:

```
TMDB_API_KEY=your_key_here
```

Restart `npm run dev` after editing `.env.local`.

---

## How it fits together

```
          ┌─────────────────────────────────────────────┐
          │  config/site.js                             │
          │  brand · theme · nav · rows · browse ·      │
          │  player servers · feature toggles           │
          └──────────────────┬──────────────────────────┘
                             │  read by everything
   ┌─────────────────────────┴─────────────────────────┐
   │                                                   │
┌──┴────────────────┐                      ┌───────────┴─────────┐
│  TMDB             │                      │  Embed provider     │
│  all metadata:    │                      │  the player iframe  │
│  posters, cast,   │                      │  only               │
│  episodes, search │                      │                     │
└───────────────────┘                      └─────────────────────┘
```

**The provider only supplies the player.** Everything you see — artwork,
ratings, genres, cast, episode lists, search — is TMDB. Nothing
is scraped, and no media is hosted or proxied by this app.

### Where the API key lives

The TMDB key is read from the environment on the server and never shipped to the
browser:

- **Server Components** import `src/lib/tmdb/*` directly.
- **Client Components** (infinite scroll) call
  `/api/tmdb/...`, which proxies to TMDB server-side and only allows the
  read-only endpoints the UI actually needs.

To confirm nothing leaked after a build:

```bash
npm run build
grep -r "$(grep TMDB_API_KEY .env.local | cut -d= -f2)" .next/static   # expect no matches
```

---

## Project layout

```
config/site.js            everything configurable, in one file
.env.local                secrets only (gitignored)

src/app/                  routes (Next.js App Router)
  page.js                 home
  movies/                 browse + /movies/[id] detail
  tv/                     browse + /tv/[id] detail
  watch/                  the player pages
  search/  person/  my-list/
  api/tmdb/[...path]/     server-side TMDB proxy

src/components/
  layout/                 sidebar, top bar, search, footer, mobile nav
  media/                  poster cards, grids, rows, hero, episode cards
  detail/                 hero, tabs, credits, reviews, seasons, buttons
  browse/                 movies + TV browse pages and result grid
  player/                 embed player, episode navigation
  ui/                     button, dropdown, carousel, skeleton, icons

src/lib/
  tmdb/                   one module per area of the API
    client.js             the only place credentials are read
    catalog.js            home feeds
    discover.js           browse page -> TMDB query
    movies.js  tv.js  search.js  people.js  genres.js
    browser.js            client-side wrapper around the proxy
  providers/              one module per provider, plus the registry
  images.js  format.js  storage.js  theme.js

src/hooks/                useMyList, useDebounce, useMediaQuery
```

Two rules keep this tidy:

1. **`config/site.js` is the only place to change how the site looks or behaves.**
2. **`src/lib/providers/` is the only place that knows a provider's URLs.**
   One module per provider; adding one or changing its format touches nothing
   else.

---

## Configuration

Open [`config/site.js`](config/site.js) — every key is commented. The highlights:

| Section    | Controls |
| ---------- | -------- |
| `brand`    | Site name, logo, tagline, favicon |
| `seo`      | Titles, description, social card, `allowIndexing` |
| `theme`    | Every colour for dark **and** light mode, radii, font |
| `nav`      | Sidebar links and their icons |
| `footer`   | Copyright line, social links, disclaimer |
| `home`     | Hero feed, and the `rows` array that builds the whole home page |
| `browse`   | Page titles and subtitles, ordering, infinite scroll |
| `detail`   | Which sections and tabs show on a title page |
| `player`   | The server list for the switcher, autoplay, episode nav |
| `features` | Turn My List, Continue watching, search or people pages on/off |
| `tmdb`     | Language, region, image sizes, cache lifetimes |

### Share cards

Links to a movie or TV show render a "ticket" preview in chat apps and social
networks — poster, title, year, rating and a serial number. These are drawn at
request time in [`src/lib/og/cards.jsx`](src/lib/og/cards.jsx), so each title gets
its own card from real data rather than one static image.

- Per-title card: `src/app/{movies,tv}/[id]/opengraph-image.js`
- Default card for every other page: `src/app/opengraph-image.js`
- Prefer your own artwork? Set `seo.ogImage` to a file in `/public`.

Set `NEXT_PUBLIC_SITE_URL` in `.env.local` to your real domain. It is printed on
the card, and social networks need an absolute URL before they will fetch the
image at all.

### Changing the brand

```js
brand: {
  name: 'My Site',
  logo: { src: '/my-logo.svg', alt: 'My Site', size: 32, showWordmark: true },
}
```

Drop your logo in `public/` and point `logo.src` at it.

### Changing the colours

```js
theme: {
  colors: {
    dark: { bg: '#07070a', accent: '#6366f1', accentText: '#ffffff', /* … */ },
  },
}
```

These become CSS variables, which Tailwind reads as `bg-bg`, `text-muted`,
`border-line`, `bg-accent` and so on. No component hardcodes a colour, so one
edit here recolours the entire site.

### Changing the home page

```js
home: {
  hero: { source: 'trending_all_week', limit: 8, autoplayMs: 7000 },
  rows: [
    { title: 'Popular movies', source: 'movie_popular', limit: 20 },
    { title: 'On the air',     source: 'tv_on_the_air', limit: 20 },
  ],
}
```

Valid `source` values are listed in `sources` in the same file, and defined in
`src/lib/tmdb/catalog.js`.

### Changing the font

Set `theme.font.family`, then swap the matching import at the top of
`src/app/layout.js` (it must be a static import so `next/font` can self-host it).

### Adding a playback server

```js
player: {
  servers: [
    { id: 'vidsrc',  label: 'Server 1', provider: 'vidsrc',  base: 'https://vidsrc.sh/embed' },
    { id: 'vidfast', label: 'Server 2', provider: 'vidfast', base: 'https://vidfast.vc' },
  ],
}
```

Two or more servers makes the switcher appear under the player. `provider` picks
the URL format and must match a module in `src/lib/providers/`
(currently `vidsrc` and `vidfast`); `base` is that provider's mirror root, so
listing one provider twice under two bases gives you a fallback mirror with no
code change. `id` and `label` are yours to choose.

To add a provider that is not there yet, write
`src/lib/providers/<name>.js` exporting `{ id, movie, episode }` — see
`vidfast.js`, it is about twenty lines — and register it in `PROVIDERS` in
`src/lib/providers/index.js`.

---

## Features

- **Home** — autoplaying hero with title artwork, plus config-driven content rows
- **Browse** — grid of everything TMDB has, ordered by popularity, with infinite
  scroll
- **Detail** — backdrop hero, Overview / Images / Videos / Collection tabs,
  season picker with episode strip, cast & crew, read-only TMDB reviews, related
  titles
- **Watch** — embedded player, server switcher, prev/next episode across season
  boundaries
- **Search** — type-ahead in the header plus a full results page with
  All / Movies / TV Shows / People tabs
- **My List & Continue watching** — saved in the browser via `localStorage`, no
  account required
- **Dark and light themes**, remembered per visitor, applied before first paint
- **Responsive** — sidebar on desktop, icon rail on tablet, bottom tab bar on
  mobile; grids run from 2 to 8 columns

### No accounts, by design

There is no login, register, profile or user-generated content. The places a
typical site would use an account are handled locally instead:

| Usually needs an account | Here |
| ------------------------ | ---- |
| Watchlist / collection   | `localStorage` **My List** |
| Continue watching        | `localStorage` watch history |
| Comments & reviews       | Read-only reviews from TMDB |
| Likes / ratings          | Omitted |

---

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm start        # serve the production build
npm run lint     # eslint
```

---

## Notes

This app stores and serves no media. It displays metadata from TMDB and embeds a
third-party player, which is responsible for its own content. Set
`seo.allowIndexing: false` in the config if you do not want the site indexed by
search engines.

This product uses the TMDB API but is not endorsed or certified by TMDB.
