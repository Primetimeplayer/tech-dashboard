# Signal — a personal tech dashboard

A static dashboard that pulls tech news (RSS), AI papers (arXiv API), and
device reviews (RSS) on a schedule and displays them in one feed. No server,
no database — scheduled scripts write JSON, a static page reads it.

```
tech-dashboard/
├── scripts/
│   ├── fetch-news.js       RSS: tech news
│   ├── fetch-papers.js     arXiv API: AI/ML papers
│   ├── fetch-reviews.js    RSS: device reviews
│   ├── fetch-reddit.js     Reddit's public .json endpoints
│   └── summarize.js        optional: rewrites summaries with an LLM
├── public/
│   ├── index.html          the dashboard itself (search + theme toggle built in)
│   └── data/                news.json, papers.json, reviews.json, reddit.json (generated)
└── .github/workflows/
    ├── update-data.yml     refetches data every 6h and commits it
    └── deploy-pages.yml    deploys public/ to GitHub Pages on push
```

The dashboard now has: a **card grid** layout, a **Latest** strip (items from
the last few hours), filters for **category, source, date range, and
hardware-only**, a **search box**, **save/bookmark with personal notes**, a
**share** button that copies a ready-to-post blurb, a **☐ theme toggle**, and
it quietly **re-checks for new data every 5 minutes** without a full page
reload.

- **Hardware highlighting** — any item whose title/summary mentions chips,
  GPUs, specific device categories, robotics, etc. gets a `⚡ Hardware`
  badge and can be isolated with the "⚡ Hardware" filter pill. The keyword
  list lives in `HARDWARE_KEYWORDS` near the top of the `<script>` block in
  `public/index.html` — edit it freely to match what you actually care
  about.
- **Saved items + notes** — click "☆ Save" on any card to bookmark it (button
  becomes "★ Saved") and a small notes box appears where you can jot down
  why it caught your eye. Click "★ Saved" in the filter row to see only your
  saved items. This is stored in your browser's `localStorage`, tied to that
  one browser — it won't sync across devices, and clearing browser data will
  clear it too.
- **Share** — click "⇪ Share" on any card to copy a ready-to-paste blurb
  (title, the why-it-matters note if there is one, and the link) to your
  clipboard, ready to drop into a tweet, Slack message, or newsletter.

## Weekly digest (content engine)

`scripts/generate-digest.js` turns the past 7 days of dashboard items into a
proper digest: an intro, highlights grouped by category with a one-line note
each, a closing line, and a parallel **thread version** (5-8 short numbered
posts) for X/Twitter or similar. A separate workflow
(`.github/workflows/generate-digest.yml`) runs this every **Monday at 14:00
UTC**, and you can also trigger it manually any time from the Actions tab.

Browse digests at `public/digests.html` on your deployed site (linked from
the main dashboard's "📰 Digests" button) — pick a week from the list, then
**Copy as Markdown** to paste straight into Substack, Buttondown, a blog
post, or a repo file, or **Show thread version** to copy something
tweet-shaped.

Like the summarizer, this uses Groq (free) by default, falling back to
Anthropic if that key is set instead, and falls back further to a
rule-based digest (using existing summaries, no new writing) if neither key
is set — it never fails to produce *something*, it just gets better prose
with a key. Same secrets as the summarizer (`GROQ_API_KEY` /
`ANTHROPIC_API_KEY`) — no extra setup needed if you already added one for
the "why it matters" notes.

To try it locally: `npm run digest` (writes into `public/digests/`). To
force a fresh one on GitHub right now: Actions tab → **Generate Weekly
Digest** → **Run workflow**.

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
- **Reddit**: edit the `SUBREDDITS` array in `scripts/fetch-reddit.js`. Also
  change the `USER_AGENT` string to include your actual Reddit username —
  Reddit rate-limits generic/default user agents more aggressively.
- **Look and feel**: all styling is in the `<style>` block of
  `public/index.html` — colors are defined once as CSS variables at the top
  (a second set under `:root[data-theme="light"]` covers light mode).

## AI summaries + "why this matters" notes (optional)

By default, summaries are the raw excerpt from each RSS feed or API, and
there's no "why it matters" note. `scripts/summarize.js` can generate both
using an LLM — it tries providers in this order, using whichever key is set:

**Option A — Groq (free, recommended)**

1. Go to [console.groq.com/keys](https://console.groq.com/keys), sign up
   (no credit card required), and create an API key.
2. **Locally**: `export GROQ_API_KEY=gsk_...` before running
   `npm run fetch:all` (or `npm run summarize` alone, to re-process existing
   data).
3. **On GitHub Actions**: repo → **Settings → Secrets and variables →
   Actions → New repository secret**, name it `GROQ_API_KEY`, paste the key.
   The workflow already passes it through.

Groq's free tier (roughly 30 requests/minute at the time of writing) is
comfortably enough for a personal dashboard refreshing every few hours.

**Option B — Anthropic (paid, used only if no Groq key is set)**

Same steps as above but with an `ANTHROPIC_API_KEY` from the
[Anthropic Console](https://console.anthropic.com/settings/keys) — this uses
paid API credits, usually a fraction of a cent per article with the small
model this script uses.

If neither key is set, `scripts/summarize.js` detects that and skips itself
— everything else keeps working with the raw excerpts and no "why it
matters" notes.

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
