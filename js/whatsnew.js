// What's new: every release, newest first, in readers' words. Opened from the small
// "v1.x.y · What's new" link at the foot of Settings. Add an entry at the top with each feature
// release; fixes go in as one "Bug fixes and polish." line (what was fixed belongs in the commit log).
// `v` is the version range the entry spans; releases before 1.3 had no version number, so it is empty.
var WHATS_NEW = [
  { d: '2026-11-14', v: '1.8.0', title: 'The AI assistant moves to DeepSeek', items: [
    'The weekly review and Ask are now answered by DeepSeek instead of Mistral AI. DeepSeek’s servers are in China; the privacy policy lists exactly what the assistant sends. It stays off until you turn it on.',
    'Ask still works out every sum with the app’s own rules and checks each figure before you see it.'
  ] },
  { d: '2026-11-04', v: '1.7.0', title: 'What’s new', items: [
    'This list: what has changed in 20bucks, newest first, from the version link at the foot of Settings.'
  ] },
  { d: '2026-10-29', v: '1.6.12 – 1.6.16', title: 'Feedback from Settings, and a tidier Ask', items: [
    'Send feedback now sits in Settings, under Help, so the feedback button no longer covers the screen.',
    'Ask is laid out like a chat app: your chats in a drawer, and the message box stays put after you send.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-26', v: '1.5.0 – 1.6.11', title: 'Ask gets its numbers right', items: [
    'Ask works out every total, table and sum with the app’s own rules instead of adding them up itself, and each answer shows the lookups it came from.',
    'Every figure in an answer is checked against your entries before you see it.',
    'Tables in an answer scroll sideways inside the reply on phones instead of squashing.',
    'On your phone, the chat follows the keyboard instead of sliding under it, and Stop ends a question that is taking too long.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-24', v: '1.3 – 1.4', title: 'You have now', items: [
    'A live “You have now” total on the Month screen.',
    'The AI assistant is open to every account. It stays off until you turn it on in Settings.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-23', v: '', title: 'Ask can make changes for you, and feedback', items: [
    'Ask can propose changes: add, edit or delete entries. Nothing changes until you tap Apply.',
    'Send feedback from inside the app: a bug, an idea, anything.',
    'Signing in with Google shows a loading screen straight away, so one tap is enough.',
    'Feels more at home on your phone, with calmer animations.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-19', v: '', title: 'Meet 20bucks: a guide and a welcome tour', items: [
    'The app has a new name: 20bucks.',
    'A help guide in Settings, and a short welcome tour the first time you open the app.',
    'The weekly AI review compares new entries with your usual notes and categories.',
    'Balance checks keep every unexplained gap open until you account for it, even across later counts.',
    'On a computer, press n for a new entry and / to search.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-14', v: '', title: 'Sign in with a code', items: [
    'Sign in with a one-time code sent to your email. No password.',
    'Every account sees only its own data.',
    'Ask looks across all your months, including what you saved each month, and shows tables and maths neatly.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-11', v: '', title: 'App lock and count gaps', items: [
    'App lock: a PIN, or Face ID or fingerprint where your phone has it, set for each device.',
    'Count gaps: find what is missing in each wallet between two balance counts.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-09', v: '', title: 'Ask gets its own tab, and live currencies', items: [
    'Ask, the AI chat, has its own tab, and your conversations sync between devices.',
    'US dollar and crypto wallets are valued at live rates, with a currency converter.',
    'Tap a category on Month to see its entries.',
    'A faster add sheet: what you picked first, your top categories, and Add always in reach.',
    'Insights opens with five blocks up front, with the rest under More patterns.',
    'A frosted look for the tab bar and sheets, and Settings in clear groups.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-08', v: '', title: 'Suggestions and an AI assistant', items: [
    'Month compares each category with what you usually spend by this day of the month.',
    'An optional AI assistant: a weekly review of new entries, and questions about your money.',
    'Suggestions flag entries that look like slips, and change nothing until you approve.',
    'Data health finds entries dated on days that don’t exist, and fixes them.',
    'Settings shows how long ago this device last downloaded a backup.',
    'Signing out warns you about changes that haven’t synced, and clears every copy from the device.',
    'When the network hangs, the app opens from its saved copy after three seconds.',
    'Bug fixes and polish.'
  ] },
  { d: '2026-10-03', v: '', title: 'The first version', items: [
    'Log income and spending with a category, a wallet, a note and tags.',
    'PayLater, budgets, subscriptions, money between friends and trading results.',
    'Balance checks: count what you have and find missed spending.',
    'Insights with charts of where your money goes.',
    'Import from Money Manager, CSV and bank statements.',
    'Syncs to your own Supabase account, works offline, and has a dark mode.'
  ] }
];
