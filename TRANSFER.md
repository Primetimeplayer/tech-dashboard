# Signal Tech — Asset Handover Guide

This is the step-by-step transfer for the buyer of Signal Tech. Complete the steps in order. The repository transfer changes the GitHub Pages URL, and the domain and analytics steps depend on who owns the repository.

Current production URL: `https://primetimeplayer.github.io/signal-tech/`

GA4 measurement ID: `G-X1DTQNYD9T`

No custom domain is attached today. Ad slots use placeholder IDs. Newsletter addresses are stored in each visitor’s browser.

Confirm DNS values against [GitHub’s custom domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) before you publish records. GitHub has changed Pages IP addresses before.

## 1. GitHub repository transfer

The repository is [Primetimeplayer/signal-tech](https://github.com/Primetimeplayer/signal-tech). The buyer needs a GitHub account.

1. Seller: open the repository → **Settings** → **General**.
2. Scroll to **Danger zone** → **Transfer ownership**.
3. Read the warnings. Enter the buyer’s GitHub username or organization name, then type `signal-tech` to confirm.
4. Buyer: accept the invitation GitHub sends. If the invitation expires, the seller starts the transfer again.
5. Buyer: open **Settings → Pages** and confirm the source is **GitHub Actions**. `.github/workflows/deploy-pages.yml` publishes the `public/` directory on every push to `main`.
6. Buyer: open **Settings → Secrets and variables → Actions**. Confirm `GROQ_API_KEY` and `ANTHROPIC_API_KEY` if those summaries should keep running. Rotate both keys after the transfer. The previous operator should revoke the old keys in the Groq and Anthropic consoles. The site still builds and the fetch jobs still commit source excerpts when those secrets are empty.
7. Buyer: run **Deploy to GitHub Pages** from the Actions tab once and confirm the new project URL loads. The URL becomes `https://<new-owner>.github.io/signal-tech/` unless the repository is also renamed.
8. If the owner or repository name changed, update absolute URLs before announcing the new address. Search the repo for `primetimeplayer.github.io/signal-tech` and replace it in:
   - canonical, Open Graph, Twitter, and JSON-LD tags in `public/index.html` and `public/digests.html`
   - the same class of tags in `public/privacy.html` and `public/terms.html`
   - `public/sitemap.xml`
   - the `Sitemap:` line in `public/robots.txt`
   - `twitter:site` once the buyer has a real X handle. The tag is omitted until then.

GitHub transfers issues, pull requests, stars, watchers, Actions workflows, and repository secrets with the repository. Verify each of those after acceptance. The previous owner loses access unless the buyer adds them back.

### What does not transfer with GitHub

The Cloudflare Worker at `https://signal-sync.primetimeplayer-signal-sync.workers.dev` is a separate Cloudflare account. The dashboard uses it for:

- live Google News at `/api/news`
- optional Google sign-in and saved-item sync (`AUTH_BASE` in `public/index.html`)

Until that worker is moved or redeployed, live edition switching and cross-device saves depend on the seller’s Cloudflare account. To move it:

1. Transfer the Cloudflare account, or create a new Worker from `cloudflare-worker/` (`wrangler` is a dev dependency; deploy from `cloudflare-worker/`, not from the repository root).
2. Replace `AUTH_BASE` and the `preconnect` hint in `public/index.html` with the new worker origin.
3. Confirm `/api/news?region=US&language=en-US` returns items, then sign in once and save a story if sync is part of the sale.

Committed files in `public/data/` keep the dashboard populated even when the worker is offline. The 6-hour Actions job does not need the worker.

## 2. Google Analytics 4 property admin transfer

The measurement ID in the site is `G-X1DTQNYD9T`. Transferring admin access, or moving the property, keeps that ID. Creating a new property or a new web stream would require a new ID in both HTML files.

Analytics loads only after the visitor clicks **Accept All** on the cookie banner (`localStorage` key `signal_tech_cookie_consent` = `all`). A Realtime test on a fresh browser stays empty until that choice is made.

### Grant the buyer Administrator

1. Seller: open [analytics.google.com](https://analytics.google.com) and select the property whose web stream ID is `G-X1DTQNYD9T`.
2. **Admin** (gear) → **Property access management**.
3. **+** → **Add users**. Enter the buyer’s Google account email.
4. Select the **Administrator** role and notify the user.
5. Buyer: accept the email and open the property. Under **Admin → Data streams**, confirm the web stream URL and the ID `G-X1DTQNYD9T`.

This shares the property. It still lives in the seller’s Google Analytics account until it is moved.

### Move the property into the buyer’s account

Do this when the buyer should own billing, access, and deletion rights outright.

1. Buyer: create a Google Analytics account if they do not already have one, and confirm they are an Administrator of that destination account.
2. Seller: **Admin → Property settings**. At the bottom, choose **Move property**.
3. Select the buyer’s destination account and complete the prompts. Historical data and the measurement ID stay with the property.
4. Buyer: open **Admin → Data streams →** the web stream. If the public URL changes (repository transfer or custom domain), edit the stream URL to the new origin.
5. Buyer: load the site, choose **Accept All**, then confirm a hit in **Reports → Realtime**.

After the move, the seller removes any remaining personal access they do not need. The HTML snippets do not need to change while the ID remains `G-X1DTQNYD9T`.

## 3. Custom domain mapping

No custom domain is configured. The site answers on the `github.io` project URL. Add the domain in the repository **before** you point DNS at GitHub, and verify the domain on the buyer’s GitHub account so another project cannot claim it. GitHub’s guide: [Verifying your custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages).

This site is published with a GitHub Actions workflow. In that mode GitHub does not require a `CNAME` file in `public/`, and an existing `CNAME` file is ignored. The domain is saved in **Settings → Pages → Custom domain**.

### Apex domain (`example.com`)

1. Buyer: **Settings → Pages → Custom domain**. Enter the apex domain and save.
2. At the DNS host, remove any parked A, AAAA, or CNAME on that name.
3. Create all four **A** records, name `@` (or the apex), values:

   ```
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```

4. Create all four **AAAA** records for IPv6:

   ```
   2606:50c0:8000::153
   2606:50c0:8001::153
   2606:50c0:8002::153
   2606:50c0:8003::153
   ```

   An **ALIAS** or **ANAME** pointing the apex at `<owner>.github.io` can replace the A and AAAA set when the DNS host supports it. The owner is the GitHub username after the transfer, currently `Primetimeplayer`.

5. Check the result:

   ```bash
   dig EXAMPLE.COM +noall +answer -t A
   dig EXAMPLE.COM +noall +answer -t AAAA
   ```

The apex should not be a CNAME. Most DNS hosts reject a CNAME on the zone root, and mail and other records on that name would break.

### `www` or another subdomain

1. Save that hostname as the Pages custom domain (or in addition to the apex, which is the recommended pair).
2. Create a **CNAME** whose name is `www` (or the chosen subdomain) and whose value is `<owner>.github.io`.

   Example after this repository is transferred to `acme`:

   ```
   www.example.com.   CNAME   acme.github.io.
   ```

   Point at the user or organization site (`<owner>.github.io`), not at `signal-tech` and not at the `*.pages.github.io` host shown in the settings page. GitHub then routes the project.

3. Check:

   ```bash
   dig www.example.com +nostats +nocomments +nocmd
   ```

   The answer should include a CNAME to `<owner>.github.io`.

When both the apex and `www` point at Pages, GitHub redirects one to the hostname saved in the custom domain field. Avoid wildcard records such as `*.example.com`.

### After DNS looks correct

1. Wait for propagation. GitHub documents up to 24 hours.
2. In **Settings → Pages**, turn on **Enforce HTTPS** once the certificate action is available.
3. Update canonicals, sitemap, robots, Open Graph image URLs, and JSON-LD to the new origin, then push to `main` so Pages redeploys.
4. In GA4, set the web stream URL to the new origin (section 2). The measurement ID stays `G-X1DTQNYD9T`.
5. Reload the site on the new hostname and confirm the certificate, the feed, and one Analytics hit after Accept All.

## 4. AdSense and sponsorship slots

The layout is ready. The slots do not serve ads. `adsbygoogle.js` is omitted on purpose, and every unit uses the placeholder client `ca-pub-xxxxxxxxxxxxxxxx`.

| File | Placement | Attribute | Replace `data-ad-slot` |
| --- | --- | --- | --- |
| `public/index.html` | In-feed unit in the story grid (`.in-feed-ad`) | `data-ad-format="fluid"` | `0000000000` |
| `public/index.html` | Sidebar “Featured Sponsor / Partner” (`.sponsor-slot`), hidden below 768px | `data-ad-format="auto"` | `0000000001` |
| `public/digests.html` | Banner inserted before the second editorial `h2` (`.digest-ad`) | `data-ad-format="auto"` | `0000000002` |

### Connect Google AdSense

1. Apply at [adsense.google.com](https://www.google.com/adsense/) with the production hostname. Approval is a Google decision and can require the custom domain from section 3.
2. After approval, copy the publisher ID (`ca-pub-` followed by digits).
3. In AdSense, create three ad units that match the formats above (one in-feed fluid unit, two responsive display units). Copy each slot ID.
4. Replace `ca-pub-xxxxxxxxxxxxxxxx` and the three `000000000x` slot values in the two HTML files.
5. Add the official AdSense loader once, on each page that contains a unit. Google’s current snippet is of this form, with the real publisher ID:

   ```html
   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-YOURPUBLISHER"
     crossorigin="anonymous"></script>
   ```

6. Push to `main` and confirm the units render on a wide desktop window. Confirm the sidebar unit is hidden when the viewport is below 768px, and that the in-feed unit is not marked up as a story card (it must not use the `card` class).

`public/privacy.html` states that the placeholder units set no advertising cookies. Before the loader ships, update the Privacy Policy and the cookie banner so advertising cookies are described and, where the law requires it, loaded only after consent. Analytics consent (`signal_tech_cookie_consent`) does not by itself authorize ad personalization.

### Direct sponsorship

The sidebar block can hold a sponsor image and link instead of an AdSense unit. Keep the existing label, the placement above Picks, and the `max-width: 767px` hide rule. Remove the empty `ins.adsbygoogle` node for that slot if no ad script should run there. Disclose paid placements in the label that is already on the page.

## 5. Newsletter subscriber list export and provider connection

There is no subscriber database in this repository, in GitHub, or on GitHub Pages.

Each successful signup writes one record in that browser only:

- Key: `signal_tech_newsletter`
- Value: `{ "email": "...", "consent": true, "subscribedAt": "<ISO timestamp>" }`
- Handler: `public/newsletter.js`
- Pages: the card on `public/index.html` and `public/digests.html`

Clearing browser data deletes the record. A returning visitor with a stored email and `consent: true` sees “You're subscribed to the Daily Signal!” and is not prompted again on that browser. The seller cannot export historical addresses, because they were never sent to a server.

### Connect a provider for new signups

The form posts to a webhook when `data-webhook` is a real `https://` URL. Placeholder values that contain `YOUR_` are ignored. The attributes `data-substack-action`, `data-beehiiv-action`, and `data-convertkit-action` are labels for the buyer. The current script does not read them.

1. Create the list in Substack, Beehiiv, ConvertKit (Kit), Buttondown, or another provider that accepts a server-side subscribe request.
2. Put that endpoint on the `<form id="newsletterForm">` in both HTML files:

   ```html
   data-webhook="https://example.com/hooks/signal-tech"
   ```

3. The browser sends:

   ```json
   { "email": "reader@example.com", "consent": true, "source": "signal-tech" }
   ```

4. If the provider expects a different body, form fields, or an API key, adapt `public/newsletter.js` and keep the API key on the provider side of the webhook. Do not put a secret key in the HTML.
5. Submit one test address, confirm it lands on the provider list, and confirm an invalid address still shows “Enter a valid email address.” and is not stored.
6. Update `public/privacy.html` so it names the provider, the purpose, and how to unsubscribe. The page currently says the address stays in the browser until a real destination replaces the placeholders.

Provider-hosted embed forms are the other path: replace the card’s form with the embed snippet from Substack, Beehiiv, or ConvertKit, and keep the visible title “Get the Daily Signal Digest” if the product name should stay stable. An embed that loads the provider’s script should be covered by the cookie banner and the Privacy Policy.

Local testing of the card does not require a provider. `npm run serve` and a valid email are enough to see the success state.

## Handover checklist

- [ ] Buyer accepted the GitHub transfer and can push to `main`.
- [ ] Pages source is GitHub Actions and the new URL loads.
- [ ] Actions secrets were verified and rotated, or intentionally left unset.
- [ ] Cloudflare Worker ownership is decided, and `AUTH_BASE` matches the worker the buyer controls.
- [ ] Buyer is Administrator on GA4 property `G-X1DTQNYD9T`, and the property has been moved if full ownership was agreed.
- [ ] Realtime shows a hit after Accept All.
- [ ] Custom domain DNS matches GitHub’s current A / AAAA / CNAME table, HTTPS is enforced, and canonicals, sitemap, robots, and social image URLs use that host.
- [ ] Ad client and slot IDs are real, or still placeholders on purpose. Privacy copy matches that choice.
- [ ] `data-webhook` points at the buyer’s list, or the card still stores addresses only in the browser. Both parties understand there is no historical list to export.
