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
};

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const plainCat = (c = "") => String(c).replace(/^\p{Extended_Pictographic}️?\s*/u, "").trim();
// a spending row's own share: a split bill counts only the owner's part (the app's ea())
export const mine = (x: Tx) => (x.t === "exp" && x.split && x.split.mine >= 0 ? x.split.mine : x.amt);
const norm = (s: unknown) => plainCat(String(s ?? "")).replace(/️/g, "").toLowerCase();
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

// One month the way the app's Month tab counts it: spent (own share), reimbursements from
// friends, income by kind, and saved = earned + other income - (spent - reimbursed).
export function monthSummary(L: Ledger, month: string) {
  const rows = L.tx.filter((x) => x.d.slice(0, 7) === month);
  let spend = 0, earned = 0, other = 0, reimb = 0;
  const byCat: Record<string, { total: number; count: number }> = {};
  const byNote: Record<string, { total: number; count: number; category: string }> = {};
  for (const x of rows) {
    if (x.t === "exp") {
      const v = mine(x), c = plainCat(x.cat) || "(no category)";
      spend += v; (byCat[c] = byCat[c] || { total: 0, count: 0 }).total += v; byCat[c].count++;
      const k = (x.note || "").trim(); if (k) { const o = byNote[k] = byNote[k] || { total: 0, count: 0, category: c }; o.total += v; o.count++; }
    } else if (x.t === "inc") {
      const k = incKind(L, x.cat); if (k === "earned") earned += x.amt; else if (k === "reimb") reimb += x.amt; else other += x.amt;
    }
  }
  const net = spend - reimb;
  return {
    month, transactions: rows.length, spent: r2(spend), reimbursed_by_friends: r2(reimb), net_spent: r2(net),
    earned_from_work: r2(earned), other_income: r2(other), income_total: r2(earned + other), saved: r2(earned + other - net),
    by_category: Object.keys(byCat).sort((a, b) => byCat[b].total - byCat[a].total).map((c) => ({ category: c, total: r2(byCat[c].total), count: byCat[c].count })),
    top_notes: Object.keys(byNote).sort((a, b) => byNote[b].total - byNote[a].total).slice(0, 15).map((k) => ({ note: k, category: byNote[k].category, total: r2(byNote[k].total), count: byNote[k].count })),
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
  out.push("EXACT MONTHLY TOTALS (SGD, own share of split bills; the tools give any finer breakdown):");
  for (const m of months) {
    const s = monthSummary(L, m);
    const top = s.by_category.slice(0, 6).map((c) => `${c.category} ${c.total}`).join(", ");
    out.push(`${m}${m === m0 ? " (so far)" : ""}: spent ${s.spent}${s.reimbursed_by_friends ? ` (friends paid back ${s.reimbursed_by_friends}, net ${s.net_spent})` : ""}, income ${s.income_total}${s.earned_from_work && s.other_income ? ` (work ${s.earned_from_work}, other ${s.other_income})` : ""}, saved ${s.saved}. Top: ${top || "nothing"}`);
  }
  const done = months.filter((m) => m < m0).slice(-12);
  if (done.length) {
    const ss = done.map((m) => monthSummary(L, m));
    const ai = sum(ss.map((s) => s.income_total)) / done.length, as = sum(ss.map((s) => s.net_spent)) / done.length, av = sum(ss.map((s) => s.saved)) / done.length;
    out.push(`Averages over the last ${done.length} complete month${done.length > 1 ? "s" : ""} (${done[0]} to ${done[done.length - 1]}): income ${r2(ai)}, net spent ${r2(as)}, saved ${r2(av)}${ai > 0.005 ? ` (${Math.round((av / ai) * 100)}% of income)` : ""}.`);
  }
  const years: Record<string, { spent: number; income: number }> = {};
  for (const x of L.tx) { const y = x.d.slice(0, 4); years[y] = years[y] || { spent: 0, income: 0 }; if (x.t === "exp") years[y].spent += mine(x); else if (x.t === "inc") years[y].income += x.amt; }
  for (const y of Object.keys(years).sort()) out.push(`Year ${y}: spent ${r2(years[y].spent)}, income ${r2(years[y].income)}`);
  const v = venueSummary(L);
  if (v.length) out.push("ACCOUNTS (cash basis, all time): " + v.map((a) => `${a.type} ${a.account}: paid in ${a.paid_in}, taken out ${a.taken_out}, net ${a.net}`).join("; "));
  return out.join("\n");
}

// Investments, prop firms, poker and crypto: money in and out per account, from the venue ledger.
export function venueSummary(L: Ledger, account?: string) {
  const venues = L.meta.venues || {};
  const per: Record<string, { type: string; inn: number; out: number; n: number; last: string; lastBal: number | null; lastBalDate: string }> = {};
  for (const e of L.led) {
    if (!e || !e.venue || (e.who && e.who !== "me" && e.f !== "bal")) continue;
    const v = per[e.venue] = per[e.venue] || { type: (venues[e.venue] && venues[e.venue].type) || "broker", inn: 0, out: 0, n: 0, last: "", lastBal: null, lastBalDate: "" };
    if (e.f === "in") v.inn += e.amt; else if (e.f === "out") v.out += e.amt; else if (e.f === "bal" && e.d >= v.lastBalDate) { v.lastBal = e.amt; v.lastBalDate = e.d; }
    v.n++; if (e.d > v.last) v.last = e.d;
  }
  const want = account ? norm(account) : "";
  return Object.keys(per).filter((k) => !want || norm(k).includes(want)).sort().map((k) => {
    const v = per[k];
    return { account: k, type: v.type, paid_in: r2(v.inn), taken_out: r2(v.out), net: r2(v.out - v.inn), entries: v.n, last_entry: v.last, ...(v.lastBal != null ? { last_balance: r2(v.lastBal), balance_date: v.lastBalDate } : {}) };
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
export function searchTransactions(L: Ledger, p: SearchParams) {
  const from = okDate(p.from) ? dayOf(p.from as string, false) : null, to = okDate(p.to) ? dayOf(p.to as string, true) : null;
  const type = p.type && p.type !== "all" ? String(p.type) : null;
  const cat = p.category ? norm(p.category) : "", note = p.note ? String(p.note).toLowerCase() : "", wallet = p.wallet ? norm(p.wallet) : "", tag = p.tag ? norm(p.tag) : "", person = p.person ? norm(p.person) : "";
  // "Spent on food" is the Food category, not the word food in a note: when the note word names a
  // category (or a subcategory in use), rows of that category match too, and the result says so.
  const noteCats = note && !cat
    ? [...new Set([...L.cats.values()].map((c) => c.name).concat(L.tx.map((x) => x.sub || "")).filter((n) => n && norm(n).includes(note)))]
    : [];
  const noteCatKeys = noteCats.map(norm);
  const rows = L.tx.filter((x) =>
    (!from || x.d >= from) && (!to || x.d <= to) && (!type || x.t === type) &&
    (!cat || norm(x.cat).includes(cat) || norm(x.sub).includes(cat)) &&
    (!note || String(x.note || "").toLowerCase().includes(note) || String(x.sub || "").toLowerCase().includes(note) ||
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
  // ready-made markdown, so the model pastes the numbers instead of retyping them
  const md = (v: number) => "$" + v.toFixed(2), NL = String.fromCharCode(10), cell = (s: string) => s.split("|").join("/");
  const gbName = p.group_by === "month" ? "Month" : p.group_by === "year" ? "Year" : p.group_by === "day" ? "Date" : String(p.group_by || "Group");
  const groupsMarkdown = groups ? ["| " + gbName[0].toUpperCase() + gbName.slice(1) + " | Total | Entries |", "|---|---:|---:|", ...groups.map((g) => `| ${cell(g.key)} | ${md(g.total)} | ${g.count} |`), `| **All** | **${md(total)}** | **${rows.length}** |`].join(NL) : undefined;
  const rowsMarkdown = list.length ? ["| Date | Amount | Category | Note |", "|---|---:|---|---|", ...list.map((r) => `| ${r.d} | ${md((r as any).my_share ?? r.amt)} | ${cell(r.cat + ((r as any).sub ? " / " + (r as any).sub : ""))} | ${cell(r.note || "")} |`)].join(NL) : undefined;
  return {
    filter: { from: from || "(start)", to: to || "(today)", type: type || "all", ...(p.category ? { category: p.category } : {}), ...(p.note ? { note: p.note } : {}), ...(p.wallet ? { wallet: p.wallet } : {}), ...(p.tag ? { tag: p.tag } : {}) },
    matched: rows.length, spent, income, total_of_matched: total,
    ...(noteCats.length ? { note_matched_category: noteCats, hint: `"${p.note}" is a category name here, so every ${noteCats.join(" / ")} row is included, not only notes containing the word` } : {}),
    ...(!type && spent > 0 && income > 0 ? { caution: `these matches mix spending (${spent}) and income (${income}); total_of_matched adds both. Pass type "exp" for spending or "inc" for income` } : {}),
    ...(groups ? { groups, groups_markdown: groupsMarkdown } : {}), rows: list, ...(rowsMarkdown ? { rows_markdown: rowsMarkdown } : {}),
    ...(rows.length > list.length ? { note: `${rows.length - list.length} more rows not listed; raise limit or narrow the filter` } : {}),
  };
}

// Plain arithmetic for the model: + - * / ^ % and brackets, nothing else runs.
export function calculate(expr: string): number {
  const s = String(expr || "").replace(/[\s,$]/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  if (!s || !/^[0-9+\-*/^%().]+$/.test(s)) throw new Error("Only numbers, + - * / ^ % and brackets are allowed.");
  let i = 0;
  const peek = () => s[i], next = () => s[i++];
  const num = (): number => {
    if (peek() === "(") { next(); const v = add(); if (next() !== ")") throw new Error("Unbalanced brackets."); return v; }
    if (peek() === "-") { next(); return -num(); }
    if (peek() === "+") { next(); return num(); }
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
  if (kind === "balance_counts") return { note: "real balances counted on a date, and what the logs said then", counts: L.checks.slice().sort((a: any, b: any) => (a.d < b.d ? -1 : 1)).slice(-40).map((c: any) => ({ d: c.d, counted: c.lines || {}, logs_said: c.exp || {} })) };
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
        note: { type: "string", description: "Text in the note, partial match (a shop, a thing bought)" },
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
    description: "Other parts of the ledger: venues (prop firms, brokers, poker, crypto: money in and out per account), people (who owes whom), paylater (bills and instalments), subscriptions, budgets, balance_counts (real balances counted against the logs), categories (the category and wallet names to use in a proposed change).",
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
