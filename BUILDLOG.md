# I Built Myself a Personal Tech Dashboard (So I Stopped Doomscrolling)

I wanted a homepage. Not a social feed optimized to keep me scrolling, not an algorithm deciding what's "relevant" to me — just the tech news, AI papers, and device reviews I actually care about, refreshed automatically, sitting at a URL I control.

Here's how I built it, what broke along the way, and what I learned.

## The stack (or lack of one)

The whole project runs on exactly **zero servers**. That was a deliberate constraint, not a limitation I hit accidentally.

- **Data collection**: a handful of Node.js scripts
- **Storage**: flat JSON files, committed straight into the Git repo
- **Automation**: GitHub Actions, on a schedule
- **Hosting**: GitHub Pages
- **Cost**: $0

If you've only ever built things with a database and a backend API, this feels almost too simple. But a personal dashboard doesn't need concurrent users, auth, or a write-heavy database — it needs data to show up somewhere reliably, on a schedule. A committed JSON file *is* a database when you don't need one to be clever.

## Sourcing data: RSS and APIs over scraping

The single most important decision was **avoiding HTML scraping wherever a feed or API existed instead**. Scraping is fragile — sites redesign, add anti-bot measures, or change their terms overnight — and it sits in a legal and ethical gray area that RSS explicitly doesn't, because RSS exists specifically to be machine-read.

So the four data sources are:
- **Tech news**: RSS feeds from The Verge, Ars Technica, TechCrunch, Wired
- **AI papers**: the [arXiv API](https://info.arxiv.org/help/api/user-manual.html) — free, no key, queryable by subject category (`cs.AI`, `cs.LG`, `cs.CL`)
- **Device reviews**: RSS again, from outlets with a dedicated reviews section
- **Community discussion**: Reddit's public `.json` endpoints (`reddit.com/r/technology/top/.json`) — no API registration needed, just a proper `User-Agent` header so you don't get rate-limited

Four small Node scripts (`fetch-news.js`, `fetch-papers.js`, `fetch-reviews.js`, `fetch-reddit.js`) each hit their source, normalize the results into a common shape, and write a JSON file.

## The automation loop

This is the part that makes it feel "alive" without me touching it:

1. A **GitHub Actions workflow** runs the fetch scripts every 6 hours (`cron: '0 */6 * * *'`), then commits whatever changed straight back into the repo.
2. A second workflow watches for any push to `main` and **redeploys the site to GitHub Pages** — so a data refresh cascades into a live redeploy automatically.
3. The page itself also quietly re-fetches its own JSON files every 5 minutes client-side, so if you leave it open in a tab, it stays current without a manual reload.

No polling server, no webhook infrastructure — just two YAML files and GitHub's own infrastructure doing the scheduling.

## Making the summaries actually useful

Raw RSS excerpts are fine, but I wanted something closer to "why should I care" than "here's the first 200 characters of the article." So I added an optional post-processing step: `summarize.js` sends each title + excerpt to an LLM and asks for exactly two things back — a one-sentence plain-English summary, and a short "why this matters" note.

I deliberately built this to **default to Groq's free tier** (Llama 3.1 8B) rather than a paid API, with an Anthropic key as an optional fallback if someone wants a stronger model. And if neither key is set, the script detects that and skips itself entirely — the dashboard still works perfectly with raw excerpts. I didn't want a "nice to have" feature to become a hard dependency.

## Feature layering

I built this in deliberate passes rather than all at once, which made debugging much easier at each stage:

1. **V1**: static list, RSS + arXiv, GitHub Pages deploy
2. **V2**: search, a fourth category (Reddit), LLM summaries, dark/light toggle
3. **V3**: card grid layout, source/date filtering, a "Latest" strip for recent items, quiet auto-refresh
4. **V4**: hardware/device highlighting via keyword matching, save-for-later bookmarks with personal notes (stored in `localStorage`), and a one-click "share as post" button that copies a ready-to-paste blurb

Each pass touched a small, contained part of the codebase, which made it easy to ship and verify incrementally instead of debugging one giant change.

## The debugging diary (the part tutorials skip)

Nothing about this went perfectly on the first try, and honestly, that's the more useful part to document:

- **Personal access tokens, twice.** GitHub no longer accepts your account password for `git push` — you need a token. Then I hit a second wall: pushing changes to `.github/workflows/*.yml` needs the token's `workflow` scope specifically, not just `repo`. Editing an existing token's scopes doesn't regenerate its string, so if you don't have the original saved, you're making a new one anyway.
- **The classic "fatal: not found" typo.** Copy-pasting a placeholder URL literally (instead of swapping in a real username) is an extremely easy mistake to make once, and instructive exactly once.
- **The reject-and-pull dance.** The automated data-fetch bot commits directly to `main` on its own schedule. If you have local uncommitted work when that happens, your next push gets rejected until you `git pull` first — and if the bot touched the same generated JSON files you have local (uncommitted, stale) copies of, you get a merge conflict on files that don't actually matter (`git checkout -- <file>` to discard the local copy resolves it instantly, since it's just regenerated data).
- **The "Pages site not found" deploy failure.** The very first deploy failed with an opaque Octokit `404` because I'd pushed the `deploy-pages.yml` workflow *before* actually flipping Settings → Pages → Source to "GitHub Actions." Order matters: enable Pages first, then let the workflow run.

None of these are exotic problems — they're the standard first-timer's tour of Git/GitHub, and now I won't hit any of them twice.

## What I'd tell someone doing this for the first time

- **Start with RSS/APIs, not scraping.** It's more stable and you'll sleep better.
- **Build in small, deployable passes.** Every layer above shipped and was verified live before the next one started.
- **Make AI features optional, not load-bearing.** The dashboard works with or without an LLM key — it just gets a little better with one.
- **The free tier is enough.** GitHub Pages, GitHub Actions, arXiv's API, Reddit's public endpoints, and Groq's free LLM tier add up to a fully automated, zero-cost personal tool.

---

**Live**: https://primetimeplayer.github.io/tech-dashboard/
**Code**: https://github.com/Primetimeplayer/tech-dashboard
