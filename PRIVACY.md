# 20bucks: Privacy

20bucks is a personal finance tracker, a personal project by Ethan Tam. It tracks spending, splits bills, follows instalments, and shows trading and poker P&L. Data syncs to your own Supabase project. This page says what we collect, why, and who else touches it.

## What we collect

- **Your account:** your email address and the name you choose to show (for sign-in via email code or Google).
- **Your finances:** transactions, categories, amounts, notes, bill splits, instalment plans, and P&L entries you enter.
- **Shared groups:** when you split bills with friends, the group members' emails and shared transactions.
- **Receipts:** photos of receipts you upload, stored in Supabase storage.
- **Basic logs:** request times and errors, kept briefly to keep the service running.

We don't sell your data, show ads, or track you across other sites.

## How AI categorisation works

When you add a transaction, we send **only the merchant name and amount** to:

- **Mistral AI** (through a Supabase Edge Function), which suggests a category.

Your email, account balance, and other transactions are never sent. The suggestion is AI-generated and can be wrong — always check it.

## Who else processes your data

- **Supabase:** database, sign-in, and receipt photo storage. Data lives in your own Supabase project.
- **Netlify** and **Cloudflare:** hosting.
- **Google:** only if you sign in with Google.
- **Google Fonts:** the page's typefaces load from Google.

## Keeping and deleting

We keep your data while your account exists. You can delete your account any time under **Settings → Delete my account**. That removes your sign-in and your data straight away. Receipts are removed from storage within 30 days. Data cached in your browser for offline use is removed when you clear your browser data.

## Your rights

You can ask for a copy of your data, or for it to be corrected or deleted, by emailing eatentam@gmail.com. We reply within 30 days. If you are in the EU/UK or Singapore, you also have the rights given by the GDPR or the PDPA.

## Children

20bucks isn't meant for anyone under 13.

## Changes

If this policy changes in a way that matters, we'll say so in the app before it takes effect.

## Contact

[eatentam@gmail.com](mailto:eatentam@gmail.com)
