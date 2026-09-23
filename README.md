# Ethan's Ledger

Personal finance tracker: spending (with Alaina tagging), prop firm, broker and poker P&L, Grab and PayLater imports, balance checks, and insights. It is a single-page web app that installs to your phone's home screen, stores data in your own Supabase project, and keeps a copy on the phone so it opens offline.

## 1. Supabase (5 minutes)

1. Create a project at supabase.com (the free tier is plenty).
2. SQL Editor → New query → paste `supabase/schema.sql` → Run.
3. Authentication → Sign In / Providers → Email: make sure it is enabled. To skip the confirmation email, turn off "Confirm email".
4. Project Settings → API: copy the Project URL and the `anon` public key into `config.js`.

## 2. GitHub Pages

1. Create a new repository (for example `ledger`) and upload every file in this folder, keeping the `icons` and `supabase` folders.
2. Settings → Pages → Source: Deploy from a branch → `main`, folder `/ (root)` → Save.
3. After a minute the app is at `https://<your-username>.github.io/ledger/`.

Free GitHub Pages needs a public repository. That only exposes the code, not your money: data lives in Supabase behind row level security, and `.gitignore` blocks backup and spreadsheet files from being committed. If you would rather keep the repo private, drag this folder onto Netlify Drop instead.

## 3. First run

1. Open the site on your phone, tap Create account, then Sign in.
2. Tap ⋯ → Restore a backup and choose `ledger-backup.json` (everything from the old app), or use Import → Money Manager export with your .xlsx.
3. Add to home screen: Safari → Share → Add to Home Screen, or Chrome → ⋮ → Install app.
4. Once your account exists, lock the door: Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".

## Updating

Edit `index.html`, commit, and Pages redeploys. If the phone keeps showing the old version, close and reopen the app twice (the offline cache refreshes in the background).
