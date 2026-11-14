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

The AI assistant is off until you turn it on in **Settings → AI assistant**. When it's on, requests go to **DeepSeek** through a Supabase Edge Function that holds the API key. **DeepSeek's servers are in China**, so what is listed below is sent there and handled under DeepSeek's own terms and privacy policy. This is personal finance data: leave the assistant off if you don't want it to leave the app. Your email address and sign-in details aren't sent. If DeepSeek is down, the same request can go to **Mistral AI** instead while the owner still has a Mistral key, and the owner can switch the assistant to **Anthropic**.

- **Weekly review:** the entries added since the last review (date, type, amount, category and note), your category list with each category's type, and, for notes you have used before, your usual type, amount and category and how often you used them, worked out from your other entries.
- **Ask:** your question and the last ten messages of that chat, plus a summary the app makes from your data: for every month, spending by category, income by source, what friends paid back and what you saved; your budgets and subscriptions; the people you split bills with and what each owes; your wallet balances, the last balance count and any gaps it left unexplained; totals for each prop firm, broker, crypto account and poker, and your latest 40 prop firm and poker entries with their notes; and what you owe on PayLater. The function adds exact monthly and yearly totals worked out from your ledger, and the entries the assistant looks up to answer, with their date, amount, category, note, wallet, tags and who a bill was split with. It can look up any entry in your history, including balance counts, PayLater bills, people and investment entries, so treat everything you have logged as something that may be sent.

Answers and suggested changes are AI-generated and can be wrong. Nothing in your ledger changes until you tap Apply.

## Who else processes your data

- **Supabase:** database, sign-in, and receipt photo storage. Data lives in your own Supabase project.
- **Cloudflare:** hosting.
- **DeepSeek** (servers in China): only if you turn on the AI assistant. **Mistral AI** or **Anthropic** only as a fallback or if the owner switches provider.
- **Google:** only if you sign in with Google.
- **Google Fonts:** the page's typefaces load from Google.

## Keeping and deleting

We keep your data while your account exists. You can delete your account any time under **Settings → Delete my account**. That removes your sign-in and your data straight away. Receipts are removed from storage within 30 days. Data cached in your browser for offline use is removed when you clear your browser data.

## Your rights

You can ask for a copy of your data, or for it to be corrected or deleted, by emailing contact@ethantam.dev. We reply within 30 days. If you are in the EU/UK or Singapore, you also have the rights given by the GDPR or the PDPA.

## Children

20bucks isn't meant for anyone under 13.

## Changes

If this policy changes in a way that matters, we'll say so in the app before it takes effect.

## Contact

[contact@ethantam.dev](mailto:contact@ethantam.dev)
