# Signal Tech — Commercial Asset Overview

Signal Tech is a turn-key news aggregation dashboard for technology, AI research, device reviews, and community discussion. The published site is static HTML, CSS, and vanilla JavaScript. Scheduled Node scripts write JSON into the repository, GitHub Actions deploys the `public/` directory, and the pages read that JSON in the browser. There is no application server and no database in the Pages site.

Live site: [https://primetimeplayer.github.io/signal-tech/](https://primetimeplayer.github.io/signal-tech/)

Repository: [https://github.com/Primetimeplayer/signal-tech](https://github.com/Primetimeplayer/signal-tech)

License: MIT (`package.json`). Publisher stories remain the property of their original outlets. The dashboard code is what the MIT license covers.

Handover steps are in [TRANSFER.md](TRANSFER.md). Marketplace copy is in [LISTING_TEMPLATE.md](LISTING_TEMPLATE.md).

## What a buyer receives

- A deployed dashboard (`public/index.html`) and a weekly digest browser (`public/digests.html`).
- A refresh pipeline that refetches sources every 6 hours and writes a weekly digest every Monday at 14:00 UTC.
- Search, topic filters, region and language selection, bookmarks with notes, share-to-clipboard, and a light/dark theme.
- SEO files, a web app manifest, favicons, and a 1200×630 social preview.
- Google Analytics 4 measurement ID `G-X1DTQNYD9T`, loaded only after the visitor chooses Accept All.
- A Privacy Policy, Terms of Service, and a GDPR-style cookie banner.
- An email capture card, “Get the Daily Signal Digest,” ready for a webhook.
- Three AdSense / sponsorship placeholders. The AdSense script is not loaded, and the client and slot IDs are placeholders.
- An optional Cloudflare Worker for live Google News proxying and saved-item sync. That worker lives in a separate Cloudflare account and does not move when the GitHub repository is transferred.

## Product features

### RSS and live feeds

`npm run fetch:all` pulls tech news, arXiv papers, device reviews, and Reddit posts into `public/data/`. Sources are RSS, Atom, or public APIs. GitHub Actions runs that job every 6 hours and commits the JSON.

On the dashboard, a live Google News request also runs through `https://signal-sync.primetimeplayer-signal-sync.workers.dev/api/news`, using the visitor’s region and language. The request budget is 6 seconds. If it times out or fails, the page keeps the committed `news.json` and may use a stale browser cache. Successful live results are cached for 5 minutes under `feed_cache_${region}_${language}`.

The page refetches the committed JSON about every 5 minutes without a full reload.

### Client-side bookmarking

“Save” stores the story and an optional note in `localStorage` under `signal-saved`. That data stays in the browser that created it. Clearing site data removes it.

The page also contains a Google sign-in path that syncs saved items through the Cloudflare Worker. The worker account is separate from this repository. See [TRANSFER.md](TRANSFER.md).

### Custom topic configuration via localStorage

The topic bar filters the feed into verticals: All News, Software & Dev, AI & Research, Chips & Silicon, Gaming & Consoles, Space & Rockets, Cybersecurity, Gadgets & Hardware, Technology, Reviews, and Community. Library filters cover hardware-only and saved items. Hash routes such as `#papers` and `#saved` open the matching filter.

Two preferences that change the live news edition are stored in `localStorage`:

| Key | What it stores |
| --- | --- |
| `region` | Edition, for example `US` |
| `language` | UI and feed language, for example `en-US` |

The interface is translated for en-US, es-419, fr, de, ja, pt-BR, hi, ko, zh-CN, it, and nl. Headlines stay in the language of the source.

Operators change which feeds exist by editing the fetch scripts (see [Customize sources](#customize-sources)). That configuration lives in the repository, not in a visitor’s browser.

Other browser keys:

| Key | What it stores |
| --- | --- |
| `signal-theme` | Light or dark theme |
| `signal-saved` | Bookmarks and notes |
| `feed_cache_${region}_${language}` | Live news cache, 5 minutes |
| `techDashboardRecents` | Up to five recently opened items |
| `signal_tech_cookie_consent` | `all` or `essential` |
| `signal_tech_newsletter` | `{ email, consent, subscribedAt }` for the digest form |
| `signal-auth-token` | Worker session, only after sign-in |

### Skeleton screen loading

While the first feed is loading, the dashboard shows a pulsing skeleton grid (`.skeleton-grid`). The skeleton is removed when stories arrive. If nothing can be shown, the status line clears and an error banner offers Retry Connection.

### GA4 analytics

`public/index.html` and `public/digests.html` define `gtag` and `loadSignalAnalytics`. The function injects `https://www.googletagmanager.com/gtag/js?id=G-X1DTQNYD9T` and calls `gtag('config', 'G-X1DTQNYD9T')` only when `signal_tech_cookie_consent` is `all`, including on later visits. Essential Only stores `essential` and leaves the script unloaded. `privacy.html` and `terms.html` do not load Analytics.

### GDPR cookie banner

`#cookieBanner` is fixed to the bottom of the dashboard and the digest page. It stays hidden until the script confirms there is no stored choice. Accept All writes `all` and loads Analytics. Essential Only writes `essential`. The choice is shared by both pages, so the banner does not return in that browser. Footer links point to `privacy.html` and `terms.html`.

### Email subscriber widget

Both pages include a card titled “Get the Daily Signal Digest,” an email field, a Subscribe button, and the line “No spam. Unsubscribe anytime.” `public/newsletter.js` checks the address in the browser. A valid address is stored as `signal_tech_newsletter` and the card shows “You're subscribed to the Daily Signal!”.

If `data-webhook` is an `https://` URL and does not contain `YOUR_`, the same submit also POSTs JSON `{ email, consent: true, source: "signal-tech" }`. The form’s Substack, Beehiiv, and ConvertKit `data-*-action` values are placeholders. The current script does not submit to those attributes. Connecting a provider is covered in [TRANSFER.md](TRANSFER.md).

Signups are not collected in a server-side list.

### Monetization layout

Three slots ship as `ins.adsbygoogle` elements with client `ca-pub-xxxxxxxxxxxxxxxx`:

| Location | Slot | Format |
| --- | --- | --- |
| `public/index.html` in-feed | `0000000000` | fluid |
| `public/index.html` sidebar, hidden below 768px | `0000000001` | auto |
| `public/digests.html` between editorial headings | `0000000002` | auto |

`adsbygoogle.js` is not included. The slots set no ad cookies until a real publisher ID, real slot IDs, and the AdSense script are added.

### SEO, sharing, and install metadata

- Self-referencing canonicals on the dashboard and the digest page.
- Open Graph and Twitter Card tags. The Twitter card is `summary_large_image`. There is no `twitter:site` handle until a real account is added.
- Preview image: `public/assets/og-preview.png` (1200×630).
- JSON-LD `WebSite` and `NewsMediaOrganization` named Signal Tech.
- `public/robots.txt` allows all agents and points at the sitemap.
- `public/sitemap.xml` lists the homepage and `digests.html`.
- `public/site.webmanifest` (`Signal Tech` / `Signal`, standalone, theme `#ffffff`) plus SVG, 32, 180, 192, and 512 icons.

These tags are implemented in the repository. A numeric SEO audit score is not stored here. Attach a fresh audit before using a score in a sales listing.

## File structure

```
signal-tech/
├── public/                     GitHub Pages publish directory
│   ├── index.html              Dashboard
│   ├── digests.html            Weekly digest browser
│   ├── privacy.html            Privacy Policy
│   ├── terms.html              Terms of Service
│   ├── newsletter.js           Digest form handler
│   ├── feed-cache.js           5-minute live-feed cache
│   ├── recent-items.js         Recent-item list
│   ├── ui-i18n.js              Interface translations
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── site.webmanifest
│   ├── assets/                 Social preview, favicon, PWA icons
│   ├── data/                   news.json, papers.json, reviews.json, reddit.json
│   └── digests/                Generated weekly digest JSON
├── scripts/
│   ├── fetch-all.js            Runs the fetchers, then summarize
│   ├── fetch-news.js           News RSS, including Google News editions
│   ├── fetch-papers.js         arXiv API
│   ├── fetch-reviews.js        Review RSS
│   ├── fetch-reddit.js         Reddit public JSON
│   ├── summarize.js            Optional “why it matters” notes
│   ├── generate-digest.js      Weekly digest and thread version
│   └── lib/                    Excerpt, image, and locale helpers
├── cloudflare-worker/          Optional sync and news proxy (separate account)
├── .github/workflows/
│   ├── deploy-pages.yml        Publishes public/ on every push to main
│   ├── update-data.yml         cron: 0 */6 * * *  (every 6 hours UTC)
│   └── generate-digest.yml     cron: 0 14 * * 1   (Monday 14:00 UTC)
├── test/                       Node tests. Browser suite needs Firefox.
├── package.json
├── TRANSFER.md
└── LISTING_TEMPLATE.md
```

`npm run fetch:all` exits with an error only when the news fetch fails, so a later source error does not block the data commit. `fetch-papers.js` calls arXiv at `http://export.arxiv.org`.

## Local setup

Requirements: Node.js 20 (the version used in GitHub Actions) and npm.

```bash
npm install
npm run fetch:all    # writes live JSON into public/data/
npm run serve        # http://localhost:8080
```

`npm run serve` uses `npx http-server` and does not need a global install. Sample JSON in `public/data/` lets the page render before the first fetch.

Other commands:

| Command | Purpose |
| --- | --- |
| `npm run fetch:news` | News only |
| `npm run fetch:papers` | arXiv only |
| `npm run fetch:reviews` | Reviews only |
| `npm run fetch:reddit` | Reddit only |
| `npm run summarize` | Optional LLM notes on existing JSON |
| `npm run digest` | Write a digest into `public/digests/` |
| `npm test` | Node tests. Skips `test/browser.test.js` when Firefox and geckodriver are absent |

On localhost, the live news request goes to the same origin’s `/api/news`. The production page uses the Cloudflare Worker.

## Customize sources

- News and reviews: `FEEDS` in `scripts/fetch-news.js` and `scripts/fetch-reviews.js`. Any RSS or Atom URL works.
- Papers: `CATEGORIES` in `scripts/fetch-papers.js`. The [arXiv taxonomy](https://arxiv.org/category_taxonomy) lists the codes.
- Reddit: `SUBREDDITS` in `scripts/fetch-reddit.js`. Change `USER_AGENT` so it identifies the new operator. Reddit rate-limits generic agents.
- Hardware badge: `HARDWARE_KEYWORDS` in the script block of `public/index.html`.
- Visual design: CSS variables and later `<style>` blocks in `public/index.html`. Later blocks override earlier ones. Desktop layout starts at `min-width: 801px`. The mobile drawer is `max-width: 800px`.

### Optional summaries and digests

`scripts/summarize.js` and `scripts/generate-digest.js` try Groq when `GROQ_API_KEY` is set, then Anthropic when `ANTHROPIC_API_KEY` is set. With neither key, summaries stay as the source excerpts and the digest falls back to a rule-based write-up. The workflows already pass both secrets through. Add them under Settings → Secrets and variables → Actions. Rotate them when ownership changes.

## Deployment

### GitHub Pages

The repository is already configured this way.

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. `.github/workflows/deploy-pages.yml` uploads `public/` and deploys it on every push to `main`, and when someone runs the workflow by hand.
3. `.github/workflows/update-data.yml` refreshes `public/data/` every 6 hours. That commit triggers a new Pages deploy.
4. `.github/workflows/generate-digest.yml` refreshes `public/digests/` on Mondays at 14:00 UTC.
5. Either data workflow can be run from the Actions tab (`workflow_dispatch`).

The project URL is `https://<owner>.github.io/<repo>/`. It is currently `https://primetimeplayer.github.io/signal-tech/`. Renaming the repository or transferring it to another owner changes that URL. A custom domain is not configured. Mapping one is in [TRANSFER.md](TRANSFER.md).

### Netlify, Vercel, or Cloudflare Pages

Connect the repository and set the publish directory to `public`. There is no frontend build command. Keep `update-data.yml` so fresh JSON is committed and the host redeploys.

## Operating notes

Every bundled source uses RSS or a public API. Feeds are the stable way to aggregate these sites. Before adding a source that has no feed, read its `robots.txt` and terms, and keep the fetch interval on the order of hours.

After a custom domain or a repository rename, update the absolute URLs in the canonical tags, `public/sitemap.xml`, `public/robots.txt`, Open Graph image tags, and the JSON-LD blocks. They currently use `https://primetimeplayer.github.io/signal-tech/`.
