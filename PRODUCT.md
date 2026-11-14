# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Ethan, the owner, tracking his own money in Singapore dollars. For now (and maybe always) he is the only person who logs in and edits. Other people do see it, though: friends or Alaina glance at it on his phone or laptop, so a screen should make sense to someone looking over his shoulder. Others may someday use their own copy, but nothing is built for that yet.

Alaina appears in the data as a tag for spending done together, not as a user.

## Product Purpose

One place for all of Ethan's money, so nothing lives in a separate spreadsheet or app:

- know where money goes each month: by category, place and person;
- notice overspending early and stay on budget;
- know honestly whether prop firms, brokers and poker make or lose money;
- never lose track of owed money: PayLater bills and instalments, who owes him, who he owes, and wallet balances that match reality.

Success is trusting the numbers without double-checking elsewhere, and logging fast enough that entries actually get logged.

## Positioning

A tracker shaped around one person's real money life in Singapore, not a generic budgeting app: Grab and Grab PayLater (with instalments and bill cycles), Money Manager history, prop-firm fees counted as spending, poker and broker P&L, money shared with or owed by friends, and periodic balance counts that reconcile against actual wallets. Data stays in the owner's own Supabase project.

## Operating Context

- Used about equally on phone (installed to the home screen as an app) and on laptop in a browser. Phone: logging right after paying, quick checks of the month. Laptop: statement imports, cleanup, deeper review.
- Hosted on Netlify from this repo; data in the owner's Supabase (`ledger_docs` table, row level security). Works offline and syncs later; edits from phone and laptop merge.
- Inputs: manual entries (with an amount calculator), Grab and bank statements (Excel, CSV, PDF or pasted text, including OCBC/DBS layouts), Money Manager exports, CSV round trips through a spreadsheet, JSON backups.
- Optional AI assistant through the owner's `ledger-ai` Supabase function (DeepSeek since 14 Nov 2026, servers in China; Mistral or Claude as alternatives): a weekly review of new entries and questions about spending.

## Capabilities and Constraints

- Month view (spent after paybacks, pace, categories, budgets, earnings), Activity (search by words, dates or amounts), Insights (trends, the Alaina lens, overview), Accounts (balances and wallets, people and shared money, PayLater bills, subscriptions, investments), Settings.
- Undo and history for every change; restore points; data health checks; Suggestions that flag likely slips and change nothing until approved.
- A single static page: `index.html` with inline script and styles, plus `sw.js`, `manifest.webmanifest`, `config.js`, fonts and icons. No build step or framework.
- The repository is public, so no secrets or personal data may be committed; keys live in Supabase.
- Terminology in use: wallet, PayLater, bill, instalment, payback, balance count, people, venue, prop firm, tag, subcategory.
- Undecided: whether other people will ever get their own accounts or copies.

## Brand Commitments

- Name: "Ethan's Ledger"; short name "Ledger" on the home screen.
- Existing copy is plain, direct and calm, written in full sentences to the owner ("Nothing changes until you approve"). Recorded from the current app, not separately confirmed as a rule.

## Evidence on Hand

- The owner's real transaction history lives in Supabase and local backups; it is private and must never be used in public material, screenshots or commits.
- App icons in `icons/`. No testimonials, users, metrics or press exist; none should be invented.

## Product Principles

1. **Numbers must be trustworthy.** A wrong total is worse than a missing feature. Imports, sync and merges must never silently change or lose data; anything uncertain is shown for approval.
2. **Logging must be fast.** If adding an entry is slow on a phone right after paying, entries stop getting logged and every other feature fails.
3. **All of it in one place.** Spending, owed money, PayLater and trading results live together so the full picture is never split across tools.
4. **Readable over a shoulder.** Others see the screen; it should be clear at a glance and not embarrass the owner with clutter or jargon.
5. **Private by default.** The data belongs to the owner and stays in his own database; anything sent elsewhere (like the AI) is opt-in and minimal.
