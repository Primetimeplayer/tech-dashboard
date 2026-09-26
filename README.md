# Signal — a personal tech dashboard

A static dashboard that pulls tech news (RSS), AI papers (arXiv API), and
device reviews (RSS) on a schedule and displays them in one feed. No server,
no database — scheduled scripts write JSON, a static page reads it.

```
tech-dashboard/
├── scripts/              fetch-news.js, fetch-papers.js, fetch-reviews.js
├── public/
│   ├── index.html         the dashboard itself
│   └── data/               news.json, papers.json, reviews.json (generated)
└── .github/workflows/
    ├── update-data.yml     refetches data every 6h and commits it
    └── deploy-pages.yml    deploys public/ to GitHub Pages on push
```

Sample placeholder data ships in `public/data/` so the page renders
immediately — run the fetch scripts (below) to replace it with live data.

## 1. Run it locally

```bash
npm install
npm run fetch:all      # pulls live news, papers, and reviews into public/data/
npm run serve          # serves public/ at http://localhost:8080
```

(`npm run serve` uses `http-server` via `npx` — no need to install it globally.)

## 2. Customize your sources

- **News / reviews**: edit the `FEEDS` array in `scripts/fetch-news.js` and
  `scripts/fetch-reviews.js`. Any RSS/Atom feed URL works — most sites expose
  one at `/feed`, `/rss`, or `/rss.xml` even if it's not linked in the nav.
- **AI papers**: edit the `CATEGORIES` array in `scripts/fetch-papers.js`.
  See the [arXiv category taxonomy](https://arxiv.org/category_taxonomy) for
  the full list (e.g. `cs.CV` for computer vision, `stat.ML` for stats/ML).
- **Look and feel**: all styling is in the `<style>` block of
  `public/index.html` — colors are defined once as CSS variables at the top.

## 3. Deploy for free

**Option A — GitHub Pages (recommended)**

1. Push this project to a new GitHub repo.
2. In the repo, go to **Settings → Pages → Build and deployment → Source**,
   and select **GitHub Actions**.
3. The included `deploy-pages.yml` workflow will publish `public/` on every
   push to `main`.
4. The included `update-data.yml` workflow refetches your sources every 6
   hours and commits the new JSON, which triggers a redeploy automatically.
5. You can also trigger either workflow manually from the repo's **Actions**
   tab (`workflow_dispatch`).

**Option B — Netlify / Vercel / Cloudflare Pages**

Connect the repo, set the publish directory to `public`, and it will deploy
on every push. Add the `update-data.yml` workflow as-is — it commits fresh
JSON to the repo, and your host's own auto-deploy picks it up.

## 4. Extend it

Ideas, roughly in order of effort:

- **LLM summaries** — in a fetch script, pipe each `summary` through an LLM
  API call to get a tighter 1–2 sentence summary instead of the raw RSS
  excerpt.
- **More categories** — add a fourth fetch script (e.g. `fetch-reddit.js`
  using Reddit's public `.json` endpoints) and a matching filter pill in
  `index.html`.
- **Read/unread state** — store seen article links in `localStorage` and
  dim items you've already opened.
- **Search** — add a text input that filters `allItems` by title/summary in
  the existing `render()` function.
- **History / database** — once you want to search across weeks of
  articles rather than just the latest fetch, move from flat JSON files to
  SQLite and a small server (e.g. Express) that serves query results.

## Notes on scraping vs. APIs

Every source here uses RSS or a public API — not HTML scraping — because
feeds are explicitly meant for this, are far more stable, and avoid ToS gray
areas. If you add a source with no feed or API, check its `robots.txt` and
terms of service before scraping its HTML, and keep your fetch frequency low
(every few hours is plenty for a news dashboard).
