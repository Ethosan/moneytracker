# Cloudflare Pages Migration — moneytracker (20bucks)

> **Account**: Log into Cloudflare Dashboard as **ethantam0206@gmail.com** (not eatentam@gmail.com).

## What changed

- **`_headers`** (new): Security + cache headers moved from `netlify.toml` to `_headers` at the repo root. Cloudflare Pages reads this from the build output directory.
- **`netlify.toml`**: Updated build command to copy `_headers` into `dist/`.

## Cloudflare Pages Setup

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Select **GitLab** → `eatentam/moneytracker`
3. Configure:
   | Setting | Value |
   |---|---|
   | Project name | `moneytracker` (or `20bucks`) |
   | Production branch | `main` |
   | Root directory | `/` (leave as default) |
   | Build command | `rm -rf dist && mkdir dist && cp -r index.html privacy.html terms.html app.css js sw.js config.js feedback-widget.js _headers manifest.webmanifest fonts icons vendor dist/` |
   | Build output directory | `dist` |
4. **Environment variables**: None needed (config is hardcoded in `config.js`).
5. **Compatibility flags**: None needed.
6. Click **Save and Deploy**

## Custom Domain

Add `20bucks.ethantam.dev` in Pages → Custom domains.

## Post-Migration

- Verify the site loads at `https://<project>.pages.dev`
- Verify at `https://20bucks.ethantam.dev`
- Verify the feedback widget works
- Verify the service worker (`sw.js`) still works
- Verify Supabase auth (Google sign-in) still works
- Verify crypto/forex data loads (CoinGecko + open.er-api.com)
