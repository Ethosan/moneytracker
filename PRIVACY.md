# 20bucks: Privacy

20bucks is a personal finance tracker, a personal project by Ethan Tam. It tracks spending, splits bills, follows instalments, and shows trading and poker P&L. Data syncs to your own Supabase project. This page says what we collect, why, and who else touches it.

## What we collect

- **Your account:** your email address and the name you choose to show (for sign-in via email code or Google).
- **Your finances:** transactions, categories, amounts, notes, bill splits, instalment plans, and P&L entries you enter.
- **Shared groups:** when you split bills with friends, the group members' emails and shared transactions.
- **Receipts:** photos of receipts you upload, stored in Supabase storage.
- **Basic logs:** request times and errors, kept briefly to keep the service running.

We don't sell your data, show ads, or track you across other sites.

## The AI assistant

The AI assistant is off until you turn it on in **Settings → AI assistant**. When it's on, requests go to **Mistral AI** (or **Anthropic**, if the owner switches provider) through a Supabase Edge Function that holds the API key. Your email address isn't sent.

- **Weekly review:** the entries added since the last review (date, type, amount, category and note), your category list, and your usual amount, type and category for those notes, worked out from your other entries.
- **Ask:** your question, the last ten messages of that conversation, and your whole history so the answer has context: every transaction with its notes, wallets and tags, the names of people you split bills with and what they owe, investment, prop firm and poker entries, PayLater bills, balance counts, subscriptions, budgets and wallet balances.

Answers and suggested changes are AI-generated and can be wrong. Nothing in your ledger changes until you tap Apply.

## Who else processes your data

- **Supabase:** database, sign-in, and receipt photo storage. Data lives in your own Supabase project.
- **Cloudflare:** hosting.
- **Mistral AI** or **Anthropic:** only if you turn on the AI assistant.
- **Google:** only if you sign in with Google.
- **Google Fonts:** the page's typefaces load from Google.

## Keeping and deleting

We keep your data while your account exists. You can delete your account any time under **Settings → Delete my account**. That removes your sign-in and your data straight away. Receipts are removed from storage within 30 days. Data cached in your browser for offline use is removed when you clear your browser data.

## Your rights

You can ask for a copy of your data, or for it to be corrected or deleted, by emailing ethan@ethantam.dev. We reply within 30 days. If you are in the EU/UK or Singapore, you also have the rights given by the GDPR or the PDPA.

## Children

20bucks isn't meant for anyone under 13.

## Changes

If this policy changes in a way that matters, we'll say so in the app before it takes effect.

## Contact

[ethan@ethantam.dev](mailto:ethan@ethantam.dev)
