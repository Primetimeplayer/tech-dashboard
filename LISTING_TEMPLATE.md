# Signal Tech — Marketplace Sales Listing

Listing copy for Flippa and Acquire.com. Replace every `[SELLER FILLS]` block before you publish. The product facts below match the repository. Traffic, revenue, asking price, and any audit score do not live in the repo, so they stay blank until you attach proof.

## Before you publish

- **SEO score.** The site ships canonicals, Open Graph, a Twitter large-image card, JSON-LD, `robots.txt`, `sitemap.xml`, a manifest, and a 1200×630 preview. Run a current Lighthouse (or equivalent) SEO audit on the production URL and attach the report. The headline line “100/100 SEO audit score” is a placeholder for that result. If the fresh score is different, replace the number. Do not publish a score you have not just measured.
- **GA4.** Measurement ID `G-X1DTQNYD9T` is installed on the dashboard and the digest page. The tag loads only after the visitor clicks Accept All. Open the property, accept cookies, and attach a Realtime or acquisition screenshot. Leave traffic totals blank until that screenshot supports them.
- **Vanilla JS.** The pages visitors load are HTML, CSS, and vanilla JavaScript. There is no React app and no frontend build. Node packages (`rss-parser`, `node-fetch`, `xml2js`, plus test and Worker dev tools) run the scheduled fetch jobs. Describe it as a vanilla JavaScript frontend, not as a repository with zero npm packages.
- **Monetization.** Three ad / sponsor placements are laid out. IDs are placeholders (`ca-pub-xxxxxxxxxxxxxxxx`, slots `0000000000`, `0000000001`, `0000000002`) and `adsbygoogle.js` is not loaded. Report revenue only if you have it. Otherwise say the layout is ready and earnings have not started.
- **Privacy.** `privacy.html`, `terms.html`, and the cookie banner are in the site. Analytics stays off until consent.
- **List size.** Newsletter rows are stored in each browser under `signal_tech_newsletter`. There is no exportable subscriber list. Say that plainly.
- **Domain.** The live URL is the GitHub Pages project URL. A custom domain is not included unless you attach one before closing.

Suggested proof to upload: Lighthouse SEO report, GA4 Realtime screenshot, desktop and mobile screenshots of the dashboard and a digest, and the MIT license note.

---

## Flippa listing

### Headline

Signal Tech — turnkey tech news dashboard, vanilla JS, GA4 installed, ad slots ready

### Short summary

Signal Tech aggregates tech news, AI papers, device reviews, and community posts into one static dashboard. GitHub Actions refreshes the data every 6 hours and deploys the site from the `public/` folder. The buyer gets the repository, the Pages workflow, a weekly digest, consent-gated GA4 (`G-X1DTQNYD9T`), a cookie banner with Privacy Policy and Terms, and a monetization layout waiting for real AdSense or sponsor units.

### Full description

Signal Tech is a turn-key news aggregation dashboard aimed at readers who want technology, research, hardware, and reviews in one place.

Visitors get:

- Live RSS-backed feeds, plus a Google News edition switcher for region and language
- Topic filters (software, AI research, chips, gaming, space, security, gadgets, reviews, community, and more)
- Client-side bookmarks and notes (`localStorage` key `signal-saved`)
- Region and language preferences saved in the browser
- Skeleton placeholders while the first feed loads
- Search, a light/dark theme, share-to-clipboard, and a weekly digest page with Markdown and thread export
- An email card, “Get the Daily Signal Digest,” that validates the address and can POST new signups to a webhook
- A GDPR-style banner: Accept All loads analytics, Essential Only does not

**100/100 SEO audit score.** *[Replace 100/100 with the score from the audit you attach. Delete this sentence if you are not attaching a report.]* The implementation behind that claim is a self-referencing canonical on each primary page, Open Graph and Twitter `summary_large_image` tags, a 1200×630 `og:image`, JSON-LD `WebSite` and `NewsMediaOrganization`, `robots.txt` allowing all agents, and `sitemap.xml` listing the home page and the digest page. A web app manifest and multi-size icons are included.

**Clean vanilla JavaScript frontend.** The published pages do not use React and do not need a build step. Scheduled Node scripts write JSON; the browser renders it. Styling and behavior live in the static files under `public/`.

**Turnkey monetization layout.** One in-feed unit, one sidebar sponsor unit (hidden below 768px), and one digest banner are already placed. Swap in an AdSense publisher ID and three slot IDs, or drop a direct sponsor into the sidebar. The AdSense script is intentionally unloaded until those IDs are real, which keeps the current privacy copy accurate.

**GDPR and privacy compliance.** The cookie choice is stored as `signal_tech_cookie_consent`. Analytics does not start before Accept All. Privacy Policy and Terms of Service are linked from the footer. Read them before you represent a specific legal outcome; they describe this product’s actual data practices, including RSS aggregation, local storage, and GA4.

**GA4 tracking verified.** *[Attach your Realtime screenshot, then keep this sentence.]* The site is wired to measurement ID `G-X1DTQNYD9T` on the dashboard and the digest page. The tag is the official gtag snippet and it runs only after consent. Legal pages do not load it.

### Assets included

- GitHub repository (transfer steps in `TRANSFER.md`)
- GitHub Pages deploy on push to `main`
- 6-hour data refresh and Monday 14:00 UTC digest workflows
- Source fetchers for news RSS, arXiv, review RSS, and Reddit
- Optional Groq or Anthropic summaries when the buyer adds API keys
- MIT license on the dashboard code
- Handover guide covering the repo, GA4, DNS, ads, and the newsletter webhook

### Assets not included unless agreed separately

- A custom domain (none is configured)
- The Cloudflare Worker account that proxies live Google News and optional saved-item sync
- An AdSense account, sponsor contracts, or historical ad revenue
- A central email list (signups never left the browser)
- Traction metrics beyond what the GA4 property shows after you export them

### Tech stack

HTML, CSS, vanilla JavaScript, JSON data files, Node.js 20 fetch scripts, GitHub Actions, GitHub Pages. Optional Cloudflare Worker.

### Monetization

Layout is ready for AdSense or a direct sidebar sponsor. Current revenue: `[SELLER FILLS — 0 if the placeholders were never swapped]`.

How a buyer turns it on is documented in `TRANSFER.md`: replace `ca-pub-xxxxxxxxxxxxxxxx` and slots `0000000000`, `0000000001`, and `0000000002`, then add the AdSense script and update the Privacy Policy.

Other income paths already supported by the product: a webhook-connected newsletter, weekly digest syndication, and direct sponsors in the sidebar slot.

### Traffic and analytics

- GA4 property ID: `G-X1DTQNYD9T`
- Monthly users: `[SELLER FILLS from GA4]`
- Monthly sessions: `[SELLER FILLS from GA4]`
- Top countries: `[SELLER FILLS]`
- Reporting window: `[SELLER FILLS]`

Analytics is consent-gated, so GA4 under-counts visitors who choose Essential Only or ignore the banner.

### Operations

Hosting cost on GitHub Pages is $0 at the current static size. The data jobs run on GitHub-hosted runners. Optional costs are a Groq or Anthropic key, a Cloudflare Worker plan if sync stays on, a domain renewal, and an email provider once the webhook is connected.

Time to operate: the feeds refresh unattended. A new owner edits `FEEDS`, arXiv categories, and subreddit lists when they want different sources.

### Growth ideas

- Map a custom domain and resubmit the sitemap
- Approve AdSense or sell the sidebar sponsor unit
- Point `data-webhook` at Beehiiv, ConvertKit, Substack, or Buttondown
- Add the digest export to a weekly send
- Tune the topic list toward a niche the buyer already reaches

### Deal terms

- Asking price: `[SELLER FILLS]`
- Monthly profit: `[SELLER FILLS or “pre-revenue”]`
- Reason for sale: `[SELLER FILLS]`
- Transfer: GitHub repository plus GA4 property `G-X1DTQNYD9T`, following `TRANSFER.md`

---

## Acquire.com listing

### One-liner

Signal Tech is a turnkey tech-news dashboard: vanilla JavaScript, scheduled RSS aggregation, consent-gated GA4, and a monetization layout ready for ads or sponsors.

### Business overview

Signal Tech publishes a single news product at `https://primetimeplayer.github.io/signal-tech/`. Readers browse tech news, AI papers, reviews, and community posts, filter by topic, switch region and language, and save stories in the browser. A weekly digest page turns the last seven days into Markdown or a short thread.

The business is pre-revenue unless the seller fills in figures below. The asset is the product, the refresh pipeline, the analytics property, and the legal/consent shell, sold as a repository transfer.

### Product

The public site is static. GitHub Actions commits fresh JSON every 6 hours and deploys `public/` to GitHub Pages. A Monday workflow writes the weekly digest. The interface shows skeleton screens during the first load, then the card grid.

Visitor preferences (theme, region, language, bookmarks, cookie choice, and the digest signup) stay in `localStorage`. That keeps the Pages site free of a user database. It also means the newsletter has no central export. New subscribers can be forwarded with one HTTPS webhook when the buyer connects a provider.

GA4 `G-X1DTQNYD9T` is installed and verified in the page source: the gtag script is injected only when cookie consent is `all`. `[SELLER FILLS — link or attach the Realtime screenshot you captured in the GA4 property.]`

Search and social metadata are in place for the current `github.io` URL: canonicals, Open Graph, Twitter large image, JSON-LD, robots, and sitemap. **100/100 SEO audit score** — publish this figure only with the audit export attached, and substitute the measured score if it is not 100.

### Customers

`[SELLER FILLS — who reads it, any newsletter or social audience you personally own, and any sponsors in discussion. Do not count browser-local signups as a list size.]`

### Financials

| Item | Amount |
| --- | --- |
| Trailing revenue | `[SELLER FILLS]` |
| Trailing profit | `[SELLER FILLS]` |
| MRR | `[SELLER FILLS]` |
| Asking price | `[SELLER FILLS]` |

Hosting is GitHub Pages. Variable costs are optional LLM keys, domain, email provider, and the separate Cloudflare Worker if the buyer keeps live news proxying and saved-item sync.

### Technology

- Frontend: HTML, CSS, vanilla JavaScript, no React, no frontend build
- Data: committed JSON refreshed by Node scripts (RSS, arXiv API, Reddit public JSON)
- Hosting: GitHub Actions → GitHub Pages, publish directory `public/`
- Analytics: GA4 `G-X1DTQNYD9T`, consent-gated
- Compliance surface: cookie banner, `privacy.html`, `terms.html`
- Monetization surface: in-feed, sidebar, and digest slots, currently placeholders
- License: MIT for the dashboard code. Source articles remain with their publishers.
- Out of repo: Cloudflare Worker account, AdSense account, custom domain

### Why this is straightforward to take over

A new owner can run the site without rewriting it. Pages deploys on push. Feeds refresh on a cron. Topics, bookmarks, and the cookie banner already work. AdSense is a configuration change (publisher ID, three slot IDs, the official script, and a privacy-policy update). A newsletter provider is a webhook URL. Domain, GA4 admin, and the repository move are written up in `TRANSFER.md`.

### Reason for sale

`[SELLER FILLS]`

### Handover

Seller transfers the GitHub repository and Administrator rights on the GA4 property, then moves the property into the buyer’s Analytics account if the purchase includes full ownership. DNS, AdSense, and the newsletter webhook are buyer setup steps with the commands and record values documented in the repo. Both sides should assume the historical email list is empty.
