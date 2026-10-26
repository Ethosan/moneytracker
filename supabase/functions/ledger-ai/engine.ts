// The exact-numbers engine behind the Ask chat. The language model never adds anything up:
// it calls these tools, and every total, filter and calculation is worked out here with the same
// rules the app uses on its own screens (monthStats, ea, incKind), so the chat and the app agree.
//
// Plain TypeScript with erasable types only: Deno runs it inside the Edge Function, and Node 22+
// runs the same file in tests/ledger-ai-engine.test.mjs without a build step.

export type Tx = {
  id?: string; feeOf?: string; propOf?: string; d: string; t: string; amt: number; cat?: string; sub?: string;
  note?: string; acct?: string; pm?: string; plp?: string; tags?: string[]; split?: { mine: number; person: string };
  from?: string; to?: string; inst?: { n: number; fee?: number };
};
export type Cat = { name: string; type?: string; kind?: string };
export type Ledger = {
  tx: Tx[]; meta: Record<string, any>; led: any[]; debts: any[]; bills: any[]; checks: any[];
  cats: Map<string, Cat>; editable: Set<string>; wallets: Set<string>;
  tz?: string; // the owner's time zone (from the app's snapshot), for the times of balance counts
};

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const plainCat = (c = "") => String(c).replace(/^\p{Extended_Pictographic}️?\s*/u, "").trim();
// a spending row's own share: a split bill counts only the owner's part (the app's ea())
export const mine = (x: Tx) => (x.t === "exp" && x.split && x.split.mine >= 0 ? x.split.mine : x.amt);
// names compared without any emoji, wherever the model put it ("Food 🍜" is Food), and in lower case
const norm = (s: unknown) => plainCat(String(s ?? "")).replace(/[\p{Extended_Pictographic}‍️]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
const sum = (a: number[]) => r2(a.reduce((x, y) => x + y, 0));

// The documents as the app stores them (meta, ledger, debts, bills, checks, one tx-YYYY-MM per month).
export function loadLedger(doc: Record<string, any>): Ledger {
  const tx: Tx[] = Object.keys(doc).filter((k) => k.startsWith("tx-")).flatMap((k) => (doc[k] && doc[k].items) || [])
    .filter((x: Tx) => x && typeof x.d === "string" && Number.isFinite(x.amt))
    .sort((a: Tx, b: Tx) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const meta = doc.meta || {};
  const cats = new Map<string, Cat>(((meta.cats || []) as any[]).filter((c) => c && c.name).map((c) => [String(c.name), { name: String(c.name), type: c.type === "inc" ? "inc" : "exp", kind: c.kind }]));
  // rows a proposed change may touch: real spending or income with an id, not fee rows or
  // investment mirrors (the app keeps those in step with their source)
  const editable = new Set<string>(tx.filter((x) => x.id && !x.feeOf && !x.propOf && (x.t === "exp" || x.t === "inc")).map((x) => x.id as string));
  const wallets = new Set<string>(((meta.accounts || []) as any[]).filter((a) => a && a.name && !a.liability).map((a) => String(a.name)));
  return {
    tx, meta, cats, editable, wallets,
    led: (doc.ledger && doc.ledger.entries) || [],
    debts: (doc.debts && doc.debts.entries) || [],
    bills: (doc.bills && doc.bills.entries) || [],
    checks: (doc.checks && doc.checks.entries) || [],
  };
}

const incKind = (L: Ledger, cat?: string) => { const c = L.cats.get(cat || ""); return (c && c.kind) || "other"; };

// ---- when an entry or a balance count was saved, and which side of a count an entry falls on ----
// The app's ids are 'a' + Date.now() in base 36 (8 characters from 1972 to 2059) + a random tail, so
// every entry and every count carries the moment it was saved; an explicit `at` (ISO) wins. Same
// rules as js/dates.js in the app, so the chat and the app agree on which side an entry is on.
export function whenMade(x: any): number | null {
  if (!x) return null;
  if (typeof x.at === "string") { const t = Date.parse(x.at); if (!Number.isNaN(t)) return t; }
  if (typeof x.id !== "string" || !/^a[0-9a-z]{9,13}$/.test(x.id)) return null;
  const ms = parseInt(x.id.slice(1, 9), 36);
  return ms > 1.3e12 && ms < 2.8e12 ? ms : null;
}
// A count is a snapshot of the moment it was saved, not of the end of its day: on the count's own day
// an entry logged after that moment is after the count and was not inside the counted figure. With no
// time on either side the day's entries count as before (the old end-of-day rule).
export function afterCount(c: any, e: any): boolean {
  if (!c || !e || !e.d || !c.d) return false;
  if (e.d > c.d) return true;
  if (e.d < c.d) return false;
  const tc = whenMade(c), te = whenMade(e);
  return tc != null && te != null && te > tc;
}
export function fmtTime(ms: number | null, tz?: string): string | null {
  if (ms == null) return null;
  for (const zone of [tz || "Asia/Singapore", "Asia/Singapore"]) {
    try { return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)); } catch { /* unknown zone: try the default */ }
  }
  return null;
}

// One month the way the app's Month tab counts it: spent (own share), reimbursements from
// friends, income by kind, and saved = earned + other income - (spent - reimbursed).
export function monthSummary(L: Ledger, month: string) {
  const rows = L.tx.filter((x) => x.d.slice(0, 7) === month);
  let spend = 0, earned = 0, other = 0, reimb = 0;
  const byCat: Record<string, { total: number; count: number }> = {};
  const byNote: Record<string, { total: number; count: number; category: string; note: string }> = {};
  for (const x of rows) {
    if (x.t === "exp") {
      const v = mine(x), c = plainCat(x.cat) || "(no category)";
      spend += v; (byCat[c] = byCat[c] || { total: 0, count: 0 }).total += v; byCat[c].count++;
      // notes merge regardless of case and spacing ("Claude ai" and "Claude AI" are one line)
      const k = (x.note || "").replace(/\s+/g, " ").trim().toLowerCase(); if (k) { const o = byNote[k] = byNote[k] || { total: 0, count: 0, category: c, note: (x.note || "").replace(/\s+/g, " ").trim() }; o.total += v; o.count++; }
    } else if (x.t === "inc") {
      const k = incKind(L, x.cat); if (k === "earned") earned += x.amt; else if (k === "reimb") reimb += x.amt; else other += x.amt;
    }
  }
  const net = spend - reimb;
  return {
    month, transactions: rows.length, spent: r2(spend), reimbursed_by_friends: r2(reimb), net_spent: r2(net),
    earned_from_work: r2(earned), other_income: r2(other), income_total: r2(earned + other), saved: r2(earned + other - net),
    by_category: Object.keys(byCat).sort((a, b) => byCat[b].total - byCat[a].total).map((c) => ({ category: c, total: r2(byCat[c].total), count: byCat[c].count })),
    top_notes: Object.keys(byNote).sort((a, b) => byNote[b].total - byNote[a].total).slice(0, 15).map((k) => ({ note: byNote[k].note, category: byNote[k].category, total: r2(byNote[k].total), count: byNote[k].count })),
  };
}

export function monthsWithEntries(L: Ledger) {
  return [...new Set(L.tx.map((x) => x.d.slice(0, 7)))].sort();
}

// The compact exact-totals block at the top of every conversation: one line a month plus the
// averages a savings question needs (the current month is left out of the averages, since it
// is not over). Everything finer comes from the tools.
export function overview(L: Ledger, today: string) {
  const out: string[] = [];
  const months = monthsWithEntries(L), m0 = today.slice(0, 7);
  out.push("EXACT MONTHLY TOTALS (SGD, own share of split bills). Top = the month's largest categories only, not all of them: a category total over any period comes from search_transactions, never from adding these:");
  for (const m of months) {
    const s = monthSummary(L, m);
    const top = s.by_category.slice(0, 6).map((c) => `${c.category} ${c.total}`).join(", ");
    out.push(`${m}${m === m0 ? " (so far)" : ""}: spent ${s.spent}${s.reimbursed_by_friends ? ` (friends paid back ${s.reimbursed_by_friends}, net ${s.net_spent})` : ""}, income ${s.income_total}${s.earned_from_work && s.other_income ? ` (work ${s.earned_from_work}, other ${s.other_income})` : ""}, saved ${s.saved}. Top: ${top || "nothing"}`);
  }
  const done = months.filter((m) => m < m0).slice(-12);
  if (done.length) {
    const ss = done.map((m) => monthSummary(L, m));
    const ti = sum(ss.map((s) => s.income_total)), ts = sum(ss.map((s) => s.net_spent)), tv = sum(ss.map((s) => s.saved));
    const ai = ti / done.length, as = ts / done.length, av = tv / done.length;
    const span = `the last ${done.length} complete month${done.length > 1 ? "s" : ""} (${done[0]} to ${done[done.length - 1]}, the current month left out)`;
    out.push(`Totals over ${span}: income ${ti}, net spent ${ts}, saved ${tv}. A share of income over this period divides by this income ${ti}, nothing else.`);
    out.push(`Averages per month over ${span}: income ${r2(ai)}, net spent ${r2(as)}, saved ${r2(av)}${ai > 0.005 ? ` (${Math.round((av / ai) * 100)}% of income)` : ""}.`);
  }
  const years: Record<string, { spent: number; income: number }> = {};
  for (const x of L.tx) { const y = x.d.slice(0, 4); years[y] = years[y] || { spent: 0, income: 0 }; if (x.t === "exp") years[y].spent += mine(x); else if (x.t === "inc") years[y].income += x.amt; }
  for (const y of Object.keys(years).sort()) out.push(`Year ${y}: spent ${r2(years[y].spent)}, income ${r2(years[y].income)}`);
  const v = venueSummary(L);
  if (v.length) out.push(`ACCOUNTS (${cashBasis(L) ? "cash" : "balance"} basis, all time, as the app's Accounts screen counts them): ` + v.map((a: any) =>
    `${a.type} ${a.account}: paid in ${a.paid_in}${a.basis === "cash" && a.opening_balance != null ? ` (incl. opening balance ${a.opening_balance})` : ""}, taken out ${a.taken_out}, result ${a.net == null ? "n/a" : a.net}${a.still_in_account ? `, still in the account ${a.still_in_account}` : ""}${a.last_balance != null ? `, last balance ${a.last_balance}` : ""}`).join("; "));
  return out.join("\n");
}

// Investments, prop firms, poker and crypto: money in and out per account, from the venue ledger,
// with the app's venuePnl rules so the "result" here equals the one on the Accounts screen.
// Cash basis (prop firms and poker always; brokers and crypto unless meta.basis says otherwise):
// result = taken out - paid in, and a balance logged before any deposit is capital carried in,
// so it counts as paid in. Otherwise the result is balance-based: last balance - opening balance
// + money taken out - money paid in between the two.
export const cashBasis = (L: Ledger) => (L.meta.basis || "cash") === "cash";
export function venueSummary(L: Ledger, account?: string) {
  const venues = L.meta.venues || {};
  const names = [...new Set(L.led.filter((e: any) => e && e.venue).map((e: any) => String(e.venue)))];
  const want = account ? norm(account) : "";
  return names.filter((k) => !want || norm(k).includes(want)).sort().map((k) => {
    const type = (venues[k] && venues[k].type) || "broker", closed = !!(venues[k] && venues[k].closed);
    const all = L.led.filter((e: any) => e && e.venue === k);
    // the owner's own flows plus every balance, oldest first; a balance on the same day as a flow comes after it
    const es = all.filter((e: any) => !e.who || e.who === "me" || e.f === "bal")
      .sort((a: any, b: any) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.f === "bal" ? 1 : 0) - (b.f === "bal" ? 1 : 0)));
    const o: Record<string, unknown> = { account: k, type, entries: all.length, last_entry: es.length ? es[es.length - 1].d : "" };
    let inn = 0, out = 0;
    if (type === "prop" || type === "poker" || cashBasis(L)) {
      let lastBal: number | null = null, lastBalDate = "", opening: number | null = null;
      if (es.length && es[0].f === "bal") { opening = es[0].amt; inn += es[0].amt; }
      es.forEach((e: any, i: number) => { if (e.f === "in") inn += e.amt; else if (e.f === "out") out += e.amt; else if (i > 0) { lastBal = e.amt; lastBalDate = e.d; } });
      const stillIn = (type === "broker" || type === "crypto") && !closed && inn - out > 0.01 ? r2(inn - out) : 0;
      return { ...o, basis: "cash", paid_in: r2(inn), taken_out: r2(out), net: r2(out - inn),
        ...(opening != null ? { opening_balance: r2(opening), note: "the opening balance was there before tracking started, so it counts as paid in" } : {}),
        ...(lastBal != null ? { last_balance: r2(lastBal), balance_date: lastBalDate } : {}),
        ...(stillIn ? { still_in_account: stillIn, note_on_result: "money still with the account is not a result yet" } : {}) };
    }
    let startIdx = -1, start = 0;
    if (es.length && es[0].f === "bal") { startIdx = 0; start = es[0].amt; }
    let endIdx = -1;
    for (let i = es.length - 1; i > startIdx; i--) if (es[i].f === "bal") { endIdx = i; break; }
    let stale = false;
    es.forEach((e: any, i: number) => { if (i <= startIdx || e.f === "bal") return; if (e.f === "in") inn += e.amt; else out += e.amt; if (endIdx > -1 && i > endIdx) stale = true; });
    const r: Record<string, unknown> = { ...o, basis: "balance", paid_in: r2(inn), taken_out: r2(out), ...(startIdx === 0 ? { opening_balance: r2(start) } : {}) };
    if (endIdx < 0 && closed) return { ...r, last_balance: 0, net: r2(out - inn - start) };
    if (endIdx > -1) {
      let fin = 0, fout = 0;
      es.forEach((e: any, i: number) => { if (i > startIdx && i < endIdx && e.f !== "bal") { if (e.f === "in") fin += e.amt; else fout += e.amt; } });
      return { ...r, last_balance: r2(es[endIdx].amt), balance_date: es[endIdx].d, net: r2(es[endIdx].amt - start + fout - fin), ...(stale ? { note: "entries after the last balance are not in the result yet; count the balance again" } : {}) };
    }
    return { ...r, net: null, note: "no balance logged yet, so there is no result on this basis" };
  });
}

export type SearchParams = {
  from?: string; to?: string; type?: string; category?: string; note?: string; wallet?: string; tag?: string; person?: string;
  min_amount?: number; max_amount?: number; group_by?: string; limit?: number; sort?: string;
};
const okDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(d);
const dayOf = (d: string, end: boolean) => (d.length === 7 ? d + (end ? "-31" : "-01") : d);

// The one lookup behind most questions: filter the transactions, total them exactly, and group
// them when asked. Rows come back with their ids so a proposed edit can name them.
const TYPE_WORDS: Record<string, string> = { exp: "exp", expense: "exp", expenses: "exp", spending: "exp", spend: "exp", spent: "exp", inc: "inc", income: "inc", earned: "inc", xfer: "xfer", transfer: "xfer", transfers: "xfer", adj: "adj", adjustment: "adj", all: "all", "": "all" };
const GROUPS = ["none", "month", "year", "day", "category", "subcategory", "note", "wallet", "type", "tag"];
// A filter the model wrote wrongly is an error it can correct, never a silent no-op: "October 2026"
// as a date would otherwise match all time, and type "expense" would match nothing at all.
function checkParams(p: SearchParams) {
  for (const k of ["from", "to"] as const) if (p[k] != null && String(p[k]) !== "" && !okDate(p[k])) throw new Error(`${k} must be YYYY-MM-DD or YYYY-MM, not "${p[k]}".`);
  const t = TYPE_WORDS[String(p.type ?? "").trim().toLowerCase()];
  if (!t) throw new Error(`type must be exp, inc, xfer, adj or all, not "${p.type}".`);
  if (p.group_by != null && String(p.group_by) !== "" && !GROUPS.includes(String(p.group_by))) throw new Error(`group_by must be one of ${GROUPS.join(", ")}, not "${p.group_by}".`);
  return t === "all" ? null : t;
}
const wordIn = (hay: string, word: string) => new RegExp("(^|[^\\p{L}\\p{N}])" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\p{L}\\p{N}])", "u").test(hay);

export function searchTransactions(L: Ledger, p: SearchParams) {
  const type = checkParams(p);
  const from = okDate(p.from) ? dayOf(p.from as string, false) : null, to = okDate(p.to) ? dayOf(p.to as string, true) : null;
  const cat = p.category ? norm(p.category) : "", wallet = p.wallet ? norm(p.wallet) : "", tag = p.tag ? norm(p.tag) : "", person = p.person ? norm(p.person) : "";
  // The note filter: one or more terms separated by |, any of which may match the note or the
  // subcategory. A term of three letters or fewer matches whole words only ("ai" is inside Alaina,
  // haircut and chair, and those are not AI); a longer term matches inside words ("grab" finds GrabFood).
  const terms = p.note ? String(p.note).toLowerCase().split("|").map((t) => t.trim()).filter(Boolean) : [];
  const note = terms.join("|");
  const termHits = (text: string, t: string) => (t.length <= 3 ? wordIn(text, t) : text.includes(t));
  const noteText = (x: Tx) => String(x.note || "").toLowerCase(), subText = (x: Tx) => String(x.sub || "").toLowerCase();
  const noteHit = (x: Tx, t: string) => termHits(noteText(x), t) || termHits(subText(x), t);
  // "Spent on food" is the Food category, not the word food in a note: when a term is a whole word
  // of a category name (or of a subcategory in use), rows of that category match too, and the result
  // says so. Whole words only: "ai" is in "Entertainment" and "Paid back", and those are not AI.
  const noteCats = terms.length && !cat
    ? [...new Set([...L.cats.values()].map((c) => c.name).concat(L.tx.map((x) => x.sub || "")).filter((n) => n && terms.some((t) => wordIn(norm(n), t))))]
    : [];
  const noteCatKeys = noteCats.map(norm);
  const rows = L.tx.filter((x) =>
    (!from || x.d >= from) && (!to || x.d <= to) && (!type || x.t === type) &&
    (!cat || norm(x.cat).includes(cat) || norm(x.sub).includes(cat)) &&
    (!terms.length || terms.some((t) => noteHit(x, t)) ||
      (noteCatKeys.length > 0 && (noteCatKeys.includes(norm(x.cat)) || noteCatKeys.includes(norm(x.sub))))) &&
    (!wallet || norm(x.acct).includes(wallet) || norm(x.from).includes(wallet) || norm(x.to).includes(wallet) || (x.pm === "later" && ("paylater " + norm(x.plp)).includes(wallet))) &&
    (!tag || (x.tags || []).some((g) => norm(g).includes(tag))) &&
    (!person || norm(x.split && x.split.person).includes(person)) &&
    (p.min_amount == null || mine(x) >= p.min_amount) && (p.max_amount == null || mine(x) <= p.max_amount));
  const amount = (x: Tx) => (x.t === "exp" ? mine(x) : x.amt);
  const total = sum(rows.map(amount));
  const spent = sum(rows.filter((x) => x.t === "exp").map(mine)), income = sum(rows.filter((x) => x.t === "inc").map((x) => x.amt));
  const keyOf: Record<string, (x: Tx) => string> = {
    month: (x) => x.d.slice(0, 7), year: (x) => x.d.slice(0, 4), day: (x) => x.d, category: (x) => plainCat(x.cat) || "(no category)",
    subcategory: (x) => (plainCat(x.cat) || "(no category)") + (x.sub ? " / " + x.sub : ""), note: (x) => (x.note || "").trim() || "(no note)",
    wallet: (x) => x.pm === "later" ? `PayLater ${x.plp || ""}`.trim() : x.acct || "(no wallet)", type: (x) => x.t, tag: (x) => (x.tags || []).join("/") || "(no tag)",
  };
  let groups: { key: string; total: number; count: number }[] | undefined;
  const gb = p.group_by && p.group_by !== "none" ? keyOf[p.group_by] : null;
  if (gb) {
    const g: Record<string, { total: number; count: number }> = {};
    for (const x of rows) { const k = gb(x); (g[k] = g[k] || { total: 0, count: 0 }).total += amount(x); g[k].count++; }
    groups = Object.keys(g).map((k) => ({ key: k, total: r2(g[k].total), count: g[k].count }))
      .sort((a, b) => (p.group_by === "month" || p.group_by === "year" || p.group_by === "day" ? (a.key < b.key ? -1 : 1) : b.total - a.total)).slice(0, 60);
  }
  const limit = Math.max(0, Math.min(200, Math.round(Number(p.limit ?? 25)) || 0));
  const sorted = rows.slice().sort(p.sort === "largest" ? (a, b) => amount(b) - amount(a) : p.sort === "oldest" ? (a, b) => (a.d < b.d ? -1 : 1) : (a, b) => (a.d > b.d ? -1 : 1));
  const list = sorted.slice(0, limit).map((x) => ({
    d: x.d, t: x.t, amt: r2(x.amt), ...(x.split ? { my_share: r2(x.split.mine), split_with: x.split.person } : {}),
    cat: plainCat(x.cat), ...(x.sub ? { sub: x.sub } : {}), ...(x.note ? { note: x.note } : {}),
    ...(x.t === "xfer" ? { from: x.from || "?", to: x.to || "?" } : x.pm === "later" ? { paid_with: `PayLater ${x.plp || ""}`.trim() + (x.inst && x.inst.n > 1 ? ` in ${x.inst.n} instalments` : "") } : x.acct ? { wallet: x.acct } : {}),
    ...(x.tags && x.tags.length ? { tags: x.tags } : {}), ...(x.id && L.editable.has(x.id) ? { id: x.id } : {}),
  }));
  // what kinds of thing matched: a note search for "Grab" spans rides, food orders and a subscription
  const spanMap: Record<string, { total: number; count: number }> = {};
  for (const x of rows) { const k = plainCat(x.cat) || "(no category)"; (spanMap[k] = spanMap[k] || { total: 0, count: 0 }).total += amount(x); spanMap[k].count++; }
  const catSpan = Object.keys(spanMap).sort((a, b) => spanMap[b].total - spanMap[a].total).slice(0, 8).map((k) => ({ category: k, total: r2(spanMap[k].total), count: spanMap[k].count }));
  // ready-made markdown, so the model pastes the numbers instead of retyping them
  const md = (v: number) => "$" + v.toFixed(2), NL = String.fromCharCode(10), cell = (s: string) => s.split("|").join("/");
  const gbName = p.group_by === "month" ? "Month" : p.group_by === "year" ? "Year" : p.group_by === "day" ? "Date" : String(p.group_by || "Group");
  const groupsMarkdown = groups ? ["| " + gbName[0].toUpperCase() + gbName.slice(1) + " | Total | Entries |", "|---|---:|---:|", ...groups.map((g) => `| ${cell(g.key)} | ${md(g.total)} | ${g.count} |`), `| **All** | **${md(total)}** | **${rows.length}** |`].join(NL) : undefined;
  const rowsMarkdown = list.length ? ["| Date | Amount | Category | Note |", "|---|---:|---|---|", ...list.map((r) => `| ${r.d} | ${md((r as any).my_share ?? r.amt)} | ${cell(r.cat + ((r as any).sub ? " / " + (r as any).sub : ""))} | ${cell(r.note || "")} |`)].join(NL) : undefined;
  // the whole period's spending and income, for "what share of my income" questions: the same
  // dates, every category, so the share divides by the right income
  const narrowed = !!(cat || note || wallet || tag || person || p.min_amount != null || p.max_amount != null);
  const inPeriod = narrowed ? L.tx.filter((x) => (!from || x.d >= from) && (!to || x.d <= to)) : [];
  const periodSpent = sum(inPeriod.filter((x) => x.t === "exp").map(mine));
  const periodIncome = sum(inPeriod.filter((x) => x.t === "inc" && incKind(L, x.cat) !== "reimb").map((x) => x.amt));
  const periodReimb = sum(inPeriod.filter((x) => x.t === "inc" && incKind(L, x.cat) === "reimb").map((x) => x.amt));
  const head = {
    filter: { from: from || "(start)", to: to || "(today)", type: type || "all", ...(p.category ? { category: p.category } : {}), ...(p.note ? { note: p.note } : {}), ...(p.wallet ? { wallet: p.wallet } : {}), ...(p.tag ? { tag: p.tag } : {}) },
    matched: rows.length, spent, income, total_of_matched: total,
    ...(terms.length > 1 ? { by_term: terms.map((t) => { const hit = rows.filter((x) => noteHit(x, t)); return { term: t, count: hit.length, total: sum(hit.map(amount)) }; }), note_on_terms: "a row can match more than one term" } : {}),
    ...(narrowed ? { period_totals: { from: from || "(start)", to: to || "(today)", all_spending: periodSpent, all_income: periodIncome, friends_paid_back: periodReimb, net_spending: r2(periodSpent - periodReimb), note: "every category over the same dates; a share of income or of spending divides by these" } } : {}),
    ...(noteCats.length ? { note_matched_category: noteCats, hint: `"${p.note}" is a category name here, so every ${noteCats.join(" / ")} row is included, not only notes containing the word` } : {}),
    ...(!type && spent > 0 && income > 0 ? { caution: `these matches mix spending (${spent}) and income (${income}); total_of_matched adds both. Pass type "exp" for spending or "inc" for income` } : {}),
    ...(catSpan.length > 1 ? { categories: catSpan, note_on_categories: "the matches span several categories; say so rather than calling them all one thing" } : {}),
    ...(groups ? { groups, groups_markdown: groupsMarkdown } : {}),
    ...(rowsMarkdown ? { rows_markdown: rowsMarkdown } : {}),
    ...(rows.length > list.length ? { note: `${rows.length - list.length} more rows not listed; raise limit or narrow the filter` } : {}),
  };
  // The result must fit the agent's cap whole, or the model reads a cut-off table. The markdown
  // (what it pastes) comes first; the JSON rows carry the ids an edit needs, so when a long listing
  // would not fit, the rows go and the model is told how to get the ids back.
  const full = { ...head, rows: list };
  if (JSON.stringify(full).length <= RESULT_BUDGET) return full;
  return { ...head, rows: [], rows_note: `${list.length} rows are listed in rows_markdown; their ids were left out to fit. To edit one, search again with a narrower filter or a lower limit.` };
}
export const RESULT_BUDGET = 22000;  // characters; agent.ts clips anything above RESULT_CHARS (larger)

// Plain arithmetic for the model: + - * / ^ % and brackets, nothing else runs.
export function calculate(expr: string): number {
  const s = String(expr || "").replace(/[\s,$]/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  if (!s || !/^[0-9+\-*/^%().]+$/.test(s)) throw new Error("Only numbers, + - * / ^ % and brackets are allowed.");
  let i = 0;
  const peek = () => s[i], next = () => s[i++];
  const num = (): number => {
    if (peek() === "(") { next(); const v = add(); if (next() !== ")") throw new Error("Unbalanced brackets."); return v; }
    // a sign binds looser than ^, so -2^2 is -(2^2) = -4 as in ordinary arithmetic
    if (peek() === "-") { next(); return -pow(); }
    if (peek() === "+") { next(); return pow(); }
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) throw new Error("Expected a number at position " + (i + 1) + ".");
    i += m[0].length; let v = parseFloat(m[0]);
    if (peek() === "%") { next(); v /= 100; }
    return v;
  };
  const pow = (): number => { let b = num(); while (peek() === "^") { next(); b = Math.pow(b, pow()); } return b; };
  const mul = (): number => { let v = pow(); while (peek() === "*" || peek() === "/") { const op = next(); const r = pow(); if (op === "/" && r === 0) throw new Error("Division by zero."); v = op === "*" ? v * r : v / r; } return v; };
  const add = (): number => { let v = mul(); while (peek() === "+" || peek() === "-") { const op = next(); const r = mul(); v = op === "+" ? v + r : v - r; } return v; };
  const v = add();
  if (i !== s.length) throw new Error("Could not read the expression from position " + (i + 1) + ".");
  if (!Number.isFinite(v)) throw new Error("The result is not a number.");
  return v;
}

// The smaller sections: people, PayLater, subscriptions, budgets, balance counts.
export function accountSummary(L: Ledger, kind: string) {
  if (kind === "people") {
    const per: Record<string, { balance: number; entries: { d: string; amt: number; note: string }[] }> = {};
    for (const x of L.debts) { if (!x || !x.person) continue; const o = per[x.person] = per[x.person] || { balance: 0, entries: [] }; o.balance += x.amt; o.entries.push({ d: x.d, amt: r2(x.amt), note: x.note || "" }); }
    return { note: "positive balance: they owe me", people: Object.keys(per).map((n) => ({ person: n, balance: r2(per[n].balance), entries: per[n].entries.sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-30) })) };
  }
  if (kind === "paylater") return { bills: L.bills.map((b: any) => ({ provider: b.prov || "GrabPay Later", from: b.from, instalments: b.n || 1, fee: b.fee || 0, payments: (b.payments || []).map((p: any) => ({ d: p.d, amt: r2(p.amt) })) })) };
  if (kind === "subscriptions") return { subscriptions: (L.meta.subs || []).map((s: any) => ({ name: s.name, amount: s.amt, every_months: s.cycle || 1, next: s.next || null, active: s.active !== false })), monthly_total_active: sum((L.meta.subs || []).filter((s: any) => s.active !== false).map((s: any) => Number(s.amt || 0) / (s.cycle || 1))) };
  if (kind === "budgets") return { monthly_budgets: (L.meta.budgets || []).map((b: any) => ({ category: plainCat(String(b.key || "").slice(4)), amount: b.amt })) };
  if (kind === "balance_counts") {
    const cs = L.checks.slice().sort((a: any, b: any) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (whenMade(a) || 0) - (whenMade(b) || 0))).slice(-40);
    // the entries dated each count's day, and which side of the count's moment each falls on
    const sameDay = (c: any) => {
      const rows: any[] = [];
      for (const x of L.tx) if (x.d === c.d && !x.propOf && !x.feeOf) rows.push({ ...(x.id ? { id: x.id } : {}), kind: x.t === "xfer" ? "transfer" : x.t === "inc" ? "income" : x.pm === "later" ? "paylater purchase" : "spending", amt: r2(x.amt), ...(x.note ? { note: x.note } : {}), ...(x.t === "xfer" ? { from: x.from, to: x.to } : x.acct ? { wallet: x.acct } : {}), side: afterCount(c, x) ? "after" : "before", logged_at: fmtTime(whenMade(x), L.tz) });
      for (const e of L.led) if (e && e.d === c.d && e.f !== "bal") rows.push({ kind: e.f === "out" ? "investment withdrawal" : "investment deposit", account: e.venue, amt: r2(e.amt), ...(e.acct ? { wallet: e.acct } : {}), side: afterCount(c, e) ? "after" : "before", logged_at: fmtTime(whenMade(e), L.tz) });
      for (const x of L.debts) if (x && x.d === c.d && !x.txId && !x.ledgerId) rows.push({ kind: "people", person: x.person, amt: r2(x.amt), ...(x.acct ? { wallet: x.acct } : {}), side: afterCount(c, x) ? "after" : "before", logged_at: fmtTime(whenMade(x), L.tz) });
      return rows;
    };
    return {
      note: "Real balances counted at a moment, and what the logs said then. A count is a snapshot of the moment it was saved (time given), not of the end of its day: an entry dated the count day is inside the counted figure only if it was logged before the count (side before); one logged after it (side after) is taken off the balance separately. Balance now = counted + everything after the count. If a same-day entry sits on the wrong side, propose an edit with count_side.",
      counts: cs.map((c: any) => ({ d: c.d, time: fmtTime(whenMade(c), L.tz), total: c.total, counted: c.lines || {}, logs_said: c.exp || {}, same_day_entries: sameDay(c) })),
    };
  }
  if (kind === "venues") return { accounts: venueSummary(L) };
  if (kind === "categories") return { categories: [...L.cats.values()].map((c) => ({ name: c.name, type: c.type === "inc" ? "income" : "spending", ...(c.kind ? { kind: c.kind } : {}) })), wallets: [...L.wallets] };
  throw new Error("Unknown section: " + kind);
}

// Prop firm, poker, broker and crypto entries for one account, newest first.
export function venueEntries(L: Ledger, account: string, limit = 60) {
  const want = norm(account);
  const rows = L.led.filter((e: any) => e && e.venue && norm(e.venue).includes(want)).sort((a: any, b: any) => (a.d > b.d ? -1 : 1));
  return { matched: rows.length, entries: rows.slice(0, Math.max(1, Math.min(200, limit))).map((e: any) => ({ d: e.d, account: e.venue, flow: e.f === "in" ? "in (paid in / fee / buy-in)" : e.f === "out" ? "out (taken out / payout / win)" : "balance", amt: r2(e.amt), ...(e.note ? { note: e.note } : {}), ...(e.who && e.who !== "me" ? { who: e.who } : {}) })) };
}

// The tools as the model sees them (provider-neutral; index.ts adapts the shape).
export const TOOLS = [
  {
    name: "search_transactions",
    description: "Filter the owner's transactions and get their exact total, optional grouping, and the matching rows (with ids where an edit is allowed). Use it for any amount, count or list that is not already in the monthly totals: a category, a shop or note, a date range, a wallet, a person. For spending pass type \"exp\" (without it income and transfers are counted too). A category name (Food, Transport, Subscriptions...) goes in category; a shop, product or service (Grab, Claude, Netflix) goes in note. Amounts are the owner's own share of split bills. Dates are YYYY-MM-DD or YYYY-MM.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, inclusive (YYYY-MM-DD or YYYY-MM)" },
        to: { type: "string", description: "End date, inclusive (YYYY-MM-DD or YYYY-MM)" },
        type: { type: "string", enum: ["exp", "inc", "xfer", "adj", "all"], description: "exp spending, inc income, xfer transfers; default all" },
        category: { type: "string", description: "Category or subcategory name, partial match, emoji not needed" },
        note: { type: "string", description: "Text in the note or subcategory: a shop, product or service. Several alternatives separated by | (Claude|OpenAI|AI) match any of them. A term of 1-3 letters matches whole words only; a longer term also matches inside words (grab finds GrabFood)" },
        wallet: { type: "string", description: "Wallet or account the money moved on, partial match; 'paylater' for PayLater purchases" },
        tag: { type: "string", description: "A tag, partial match" },
        person: { type: "string", description: "Person a bill was split with" },
        min_amount: { type: "number" }, max_amount: { type: "number" },
        group_by: { type: "string", enum: ["none", "month", "year", "day", "category", "subcategory", "note", "wallet", "type", "tag"], description: "Also total the matches per group" },
        limit: { type: "integer", description: "How many rows to list (default 25, max 200); set 0 when only totals are needed" },
        sort: { type: "string", enum: ["newest", "oldest", "largest"] },
      },
    },
  },
  {
    name: "month_summary",
    description: "One month exactly as the app's Month tab counts it: spent, reimbursed by friends, income by kind, saved, every category's total and the biggest notes.",
    parameters: { type: "object", properties: { month: { type: "string", description: "YYYY-MM" } }, required: ["month"] },
  },
  {
    name: "calculate",
    description: "Exact arithmetic. Use it for every sum, difference, percentage, average or projection instead of working it out yourself. Supports + - * / ^ % and brackets.",
    parameters: { type: "object", properties: { expression: { type: "string", description: "e.g. (612.3+184.2)/1284.5*100" } }, required: ["expression"] },
  },
  {
    name: "account_summary",
    description: "Other parts of the ledger: venues (prop firms, brokers, poker, crypto: money in and out per account), people (who owes whom), paylater (bills and instalments), subscriptions, budgets, balance_counts (real balances counted against the logs, each count's time of day and the entries dated that day with the side of the count they fall on), categories (the category and wallet names to use in a proposed change).",
    parameters: { type: "object", properties: { section: { type: "string", enum: ["venues", "people", "paylater", "subscriptions", "budgets", "balance_counts", "categories"] } }, required: ["section"] },
  },
  {
    name: "venue_entries",
    description: "The dated entries of one prop firm, broker, poker or crypto account: fees and buy-ins paid in, payouts and wins taken out, balances.",
    parameters: { type: "object", properties: { account: { type: "string", description: "Account name, partial match" }, limit: { type: "integer" } }, required: ["account"] },
  },
];

// Runs one tool call; returns what goes back to the model and a short line for the owner
// ("Looked up Food, Oct 2026: 23 rows, 612.30").
export function runTool(L: Ledger, name: string, args: Record<string, any>): { result: unknown; label: string } {
  args = args && typeof args === "object" ? args : {};
  if (name === "search_transactions") {
    const r = searchTransactions(L, args);
    const what = [args.type === "exp" ? "spending" : args.type === "inc" ? "income" : args.type === "xfer" ? "transfers" : "transactions", args.category, args.note, args.wallet && `on ${args.wallet}`, args.tag && `#${args.tag}`, args.person && `with ${args.person}`].filter(Boolean).join(" ");
    const when = args.from || args.to ? ` ${args.from || "start"} to ${args.to || "today"}` : "";
    return { result: r, label: `Looked up ${what}${when}${args.group_by && args.group_by !== "none" ? ` by ${args.group_by}` : ""}: ${r.matched} row${r.matched === 1 ? "" : "s"}, ${r.total_of_matched}` };
  }
  if (name === "month_summary") { const m = String(args.month || ""); if (!/^\d{4}-\d{2}$/.test(m)) throw new Error("month must be YYYY-MM"); const r = monthSummary(L, m); return { result: r, label: `Summed ${m}: spent ${r.spent}, income ${r.income_total}, saved ${r.saved}` }; }
  if (name === "calculate") { const v = calculate(String(args.expression || "")); return { result: { expression: String(args.expression || ""), result: r2(v), exact: v }, label: `Worked out ${String(args.expression || "").replace(/\s+/g, "")} = ${r2(v)}` }; }
  if (name === "account_summary") { const s = String(args.section || ""); return { result: accountSummary(L, s), label: `Read the ${s.replace("_", " ")} section` }; }
  if (name === "venue_entries") { const r = venueEntries(L, String(args.account || ""), Number(args.limit) || 60); return { result: r, label: `Read ${args.account}'s entries: ${r.matched}` }; }
  throw new Error("Unknown tool: " + name);
}
