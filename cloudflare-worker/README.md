# Optional: cross-device sync for Saved items

By default, your ★ Saved items and notes live only in one browser's
`localStorage` — they won't follow you to another device. This folder is a
small Cloudflare Worker that adds a sync endpoint if you want that. It's
entirely optional; skip this whole folder and the dashboard works exactly
as before.

Free tier is plenty for one person's saved items (Cloudflare's free plan:
100,000 requests/day, 1GB of KV storage).

## Deploy it

1. Sign up at [cloudflare.com](https://dash.cloudflare.com/sign-up) (free).
2. Install Wrangler (Cloudflare's CLI), Cloudflare's official deploy tool:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. From inside this `cloudflare-worker/` folder, create the KV namespace
   that will store your saved items:
   ```bash
   wrangler kv namespace create SAVED_KV
   ```
   It prints an `id` — paste that into `wrangler.toml`, replacing
   `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.
4. Set a secret token (make up any long random string — this is what
   protects your endpoint from strangers):
   ```bash
   wrangler secret put SYNC_TOKEN
   ```
   It'll prompt you to paste the value.
5. Edit `ALLOWED_ORIGIN` in `wrangler.toml` if your GitHub Pages URL is
   different from the default already there.
6. Deploy:
   ```bash
   wrangler deploy
   ```
   It prints your Worker's URL, something like
   `https://signal-sync.yoursubdomain.workers.dev`.

## Connect it to your dashboard

On your live dashboard, click the **⚙** button next to the "★ Saved"
filter. It'll ask for:
- **Sync endpoint** — the Worker URL from step 6, with `/saved` appended
  (e.g. `https://signal-sync.yoursubdomain.workers.dev/saved`)
- **Sync token** — the same string you set in step 4

Once configured, saving/noting an item pushes to the Worker, and loading
the page pulls the latest saved set from it — so the same saved items and
notes now show up on any device where you enter the same endpoint + token.

## Notes

- This is intentionally simple: one shared token, one shared blob of saved
  items — fine for one person's own devices, not built for multiple users.
- If you'd rather not run any backend at all, just don't set this up. The
  ⚙ button does nothing until you enter an endpoint, and everything falls
  back to browser-local storage as before.
