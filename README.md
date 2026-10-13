# Ledger

Personal finance tracker: spending (with person tagging), prop firm, broker and poker P&L, Grab and PayLater imports, balance checks, and insights. It is a single-page web app that installs to your phone's home screen, stores data in your own Supabase project, and keeps a copy on the phone so it opens offline.

## 1. Supabase (10 minutes)

1. Create a project at supabase.com (the free tier is plenty).
2. SQL Editor → New query → paste `supabase/schema.sql` → Run. Safe to run again if you already ran it once — it replaces existing policies instead of failing.
3. Email sending (SMTP): Supabase’s built-in email sender is capped at a few codes per hour and often lands in spam. Use a free one instead: sign up at resend.com, open API Keys, create a key. Then in Supabase go to Project Settings → Auth → SMTP Settings, turn on Custom SMTP, and enter: Host `smtp.resend.com`, Port `587`, Username `resend`, Password = the Resend API key, Sender email `onboarding@resend.dev` (works without owning a domain), Sender name `Ledger`. Save. The free tier sends 100 emails a day, which is plenty for you and a few friends. Once you verify your own domain in Resend, change Sender email to `code@yourdomain.com` — see "Your own domain" below.
4. Authentication → Sign In / Providers → Email: make sure it is enabled. Sign-in uses a one-time code emailed to you, so no confirmation email is involved.
5. Authentication → Email Templates → Magic Link: replace the body with one that shows the code (the default template only contains a login link). Paste this as the template body:

   ```
   <h2>Your Ledger code</h2>
   <p>Enter this code in the app to sign in:</p>
   <p style="font-size:32px;font-weight:bold;letter-spacing:8px">{{ .Token }}</p>
   <p>It expires within the hour. If you did not ask for it, ignore this email. Only the newest code works — requesting another one replaces the previous code.</p>
   ```

6. Authentication → URL Configuration: set Site URL to your deployed site address, and add the same address to Redirect URLs. The app passes this address to Supabase as the email link target, so even a link in an email lands on the app and signs in by itself.
7. Project Settings → API: copy the Project URL and the `anon` public key into `config.js`.

## 2. GitHub Pages

1. Create a new repository (for example `ledger`) and upload every file in this folder, keeping the `icons` and `supabase` folders.
2. Settings → Pages → Source: Deploy from a branch → `main`, folder `/ (root)` → Save.
3. After a minute the app is at `https://<your-username>.github.io/ledger/`.

Free GitHub Pages needs a public repository. That only exposes the code, not your money: data lives in Supabase behind row level security, and `.gitignore` blocks backup and spreadsheet files from being committed. If you would rather keep the repo private, drag this folder onto Netlify Drop instead.

## Your own domain (optional)

One domain is enough for everything: your portfolio at the root, and each project on its own subdomain.

1. Buy one domain (for example `yourname.com`) at Cloudflare Registrar, Porkbun or Namecheap — about $10 a year. Avoid free domains (.tk, .ml and friends): email providers and browsers distrust them, which is also what causes "dangerous site" warnings.
2. Point the root at your portfolio site. Each project gets a subdomain: this app at `ledger.yourname.com`, the next one at `something.yourname.com`, and so on. Subdomains are separate sites, so their data and logins never overlap.
3. On Netlify: Site settings → Domain management → Add custom domain → `ledger.yourname.com`. Netlify issues free HTTPS by itself. In your DNS (for example Cloudflare), add a CNAME: `ledger` → `ledgernode.netlify.app`.
4. In Supabase: Authentication → URL Configuration → set Site URL to `https://ledger.yourname.com` and add it to Redirect URLs. The app uses whatever address it is opened from, so email links follow the new domain with no code change.
5. In Resend: Domains → Add domain → `yourname.com` → add the DNS records it gives you → wait for verification. Then in Supabase’s SMTP settings set Sender email to `code@yourname.com`. Until then, `onboarding@resend.dev` works with no verification.

## 3. First run

1. Open the site on your phone, tap Create account, then Sign in.
2. Tap ⋯ → Restore a backup and choose `ledger-backup.json` (everything from the old app), or use Import → Money Manager export with your .xlsx.
3. Add to home screen: Safari → Share → Add to Home Screen, or Chrome → ⋮ → Install app.
4. Once your account exists, lock the door: Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".

## Troubleshooting

- Sign-in shows no code box, or says sign-in is unavailable: something failed to load. Check your connection, then close the app fully and reopen it twice (updates download in the background). The sign-in library now comes from the site itself, so this should only happen on a very bad connection.
- The browser warns the site is dangerous or not secure: that is Google Safe Browsing being cautious about a code-by-email login page on a free hosting address, not a problem with your data. Tap through Advanced to visit the site. For a permanent fix, point a custom domain at the site (Netlify gives free HTTPS) and set it as the Site URL in Supabase; the app follows the address automatically.
- 504 errors in the browser console: a server hiccuped while loading. Reload once; the app keeps working from its cached copy offline.

## Updating

Edit `index.html`, commit, and Pages redeploys. If the phone keeps showing the old version, close and reopen the app twice (the offline cache refreshes in the background).

## AI assistant (optional)

Off until you turn it on in Settings → AI assistant. Once a week it sends entries added since its last look (date, type, amount, category and note only) to the AI, and anything it flags waits in Suggestions for you to approve. You can also ask it questions; each one sends your full history: every month's totals and savings, your accounts, and every entry.

The API key never goes in this repo. It lives in a Supabase Edge Function:

1. Deploy the function: `npx supabase login`, then `npx supabase functions deploy ledger-ai --project-ref <your project ref> --use-api`.
2. Supabase → Edge Functions → Secrets: add `MISTRAL_API_KEY` (or `ANTHROPIC_API_KEY` for Claude).
3. To switch to Claude later, add `ANTHROPIC_API_KEY` and set `AI_PROVIDER` to `anthropic`. Optional: `MISTRAL_MODEL`, `ANTHROPIC_MODEL`.

Set a monthly spending limit in the AI provider's dashboard as a safety net.
