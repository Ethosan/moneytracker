// The app and the Ask chat must give the same figures. The app's sums live in js/money.js; the chat's
// engine (supabase/functions/ledger-ai/engine.ts) has its own copy, since the Edge Function cannot load
// a browser script. This runs the same ledgers through both and fails when any total differs.
// Also runs a Money Manager export through js/mm-import.js and checks the imported ledger the same way.
// Node 22+ (engine.ts loads with type stripping, as in the other ledger-ai tests).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { loadLedger, monthSummary, monthsWithEntries, venueSummary, accountSummary, searchTransactions, overview, plainCat, r2 } from "../supabase/functions/ledger-ai/engine.ts";

const read = (f) => fs.readFileSync(new URL("../js/" + f, import.meta.url), "utf8");
const C = {};
// dates.js first, as in index.html: money.js's wallet sums use its afterCount, and the demo builds its counts with them
vm.runInNewContext(read("dates.js") + "\n" + read("money.js") + "\n" + read("mm-import.js") + "\n" + read("demo.js"), C);
const { Money, MM, Demo } = C;

// ---- a ledger built to hit the awkward cases ----
const CATS = [
  { name: "🍜 Food", type: "exp" }, { name: "🚌 Transport", type: "exp" }, { name: "💝 Dates", type: "exp" },
  { name: "💼 Salary", type: "inc", kind: "earned" }, { name: "📖 Tutoring", type: "inc", kind: "earned" },
  { name: "↩️ Paybacks", type: "inc", kind: "reimb" }, { name: "🏅 Bonus", type: "inc", kind: "other" },
  { name: "🎁 Gift", type: "inc" }
];
const tx = (m, items) => ({ ["tx-" + m]: { items } });
function sampleDoc(basis) {
  return {
    meta: {
      basis, cats: CATS, tags: ["Dates"],
      accounts: [{ name: "Cash" }, { name: "DBS" }, { name: "GrabPay Later", liability: true }],
      venues: { Moomoo: { type: "broker" }, IBKR: { type: "broker", closed: true }, Apex: { type: "prop" }, Poker: { type: "poker" }, Crypto: { type: "crypto" }, Webull: { type: "broker" } },
      subs: [{ name: "Spotify", amt: 10.98, cycle: 1 }, { name: "iCloud", amt: 47.88, cycle: 12 }, { name: "Gym", amt: 89, cycle: 3, active: false }, { name: "Claude", amt: 28.13 }]
    },
    ...tx("2026-08", [
      { id: "t1", d: "2026-08-01", t: "exp", amt: 0.1, cat: "🍜 Food", note: "sweet" },
      { id: "t2", d: "2026-08-01", t: "exp", amt: 0.2, cat: "🍜 Food", note: "Sweet " },
      { id: "t3", d: "2026-08-15", t: "exp", amt: 19.99, cat: "🚌 Transport", acct: "DBS" },
      { id: "t4", d: "2026-08-31", t: "inc", amt: 3200.55, cat: "💼 Salary", acct: "DBS" }
    ]),
    ...tx("2026-09", [
      { id: "t5", d: "2026-09-02", t: "exp", amt: 120, cat: "🍜 Food", split: { mine: 40, person: "Sam" }, tags: ["Dates"] },
      { id: "t6", d: "2026-09-03", t: "exp", amt: 64.5, cat: "💝 Dates", split: { mine: 0, person: "Jo" }, tags: ["Dates"] },
      { id: "t7", d: "2026-09-04", t: "exp", amt: 33.33, cat: "💝 Dates", split: { mine: -1, person: "Jo" } },
      { id: "t8", d: "2026-09-05", t: "inc", amt: 80, cat: "↩️ Paybacks", note: "Sam paid back" },
      { id: "t9", d: "2026-09-06", t: "inc", amt: 45.1, cat: "📖 Tutoring" },
      { id: "t10", d: "2026-09-07", t: "inc", amt: 200, cat: "🎁 Gift" },
      { id: "t11", d: "2026-09-08", t: "inc", amt: 12.34, cat: "Unlisted income" },
      { id: "t12", d: "2026-09-09", t: "xfer", amt: 500, from: "DBS", to: "Cash" },
      { id: "t13", d: "2026-09-10", t: "adj", amt: 3.21, cat: "🔧 Adjustment" },
      { id: "t14", d: "2026-09-11", t: "exp", amt: 150, cat: "🍜 Food", pm: "later", inst: { n: 3, fee: 2 } },
      { id: "t15", d: "2026-09-12", t: "exp", amt: 7.77, cat: "" }
    ]),
    ...tx("2026-10", [ // a month that spent more than it earned, paybacks larger than spending
      { id: "t16", d: "2026-10-01", t: "exp", amt: 15.5, cat: "🍜 Food" },
      { id: "t17", d: "2026-10-02", t: "inc", amt: 300, cat: "↩️ Paybacks" },
      { id: "t18", d: "2026-10-03", t: "inc", amt: 1000.01, cat: "🏅 Bonus" }
    ]),
    ...tx("2026-11", []),
    ledger: { entries: [
      { d: "2026-01-01", venue: "Moomoo", f: "bal", amt: 1000 },
      { d: "2026-02-01", venue: "Moomoo", f: "in", amt: 500.25 },
      { d: "2026-03-01", venue: "Moomoo", f: "bal", amt: 1650.1 }, // same day as a withdrawal: the balance comes after
      { d: "2026-03-01", venue: "Moomoo", f: "out", amt: 100 },
      { d: "2026-04-01", venue: "Moomoo", f: "in", amt: 10 }, // after the last balance
      { d: "2026-01-10", venue: "IBKR", f: "bal", amt: 2000 },
      { d: "2026-02-10", venue: "IBKR", f: "in", amt: 300 },
      { d: "2026-03-10", venue: "IBKR", f: "out", amt: 2600 }, // closed with no balance after: ends at zero
      { d: "2026-01-05", venue: "Apex", f: "in", amt: 167 },
      { d: "2026-01-06", venue: "Apex", f: "in", amt: 167, who: "Jo" },
      { d: "2026-02-20", venue: "Apex", f: "out", amt: 1200.4 },
      { d: "2026-02-21", venue: "Apex", f: "bal", amt: 50000 },
      { d: "2026-05-01", venue: "Poker", f: "in", amt: 100 },
      { d: "2026-05-02", venue: "Poker", f: "out", amt: 35.5 },
      { d: "2026-06-01", venue: "Crypto", f: "in", amt: 0.1 },
      { d: "2026-06-02", venue: "Crypto", f: "in", amt: 0.2 },
      { d: "2026-06-03", venue: "Crypto", f: "out", amt: 0.3 },
      { d: "2026-07-01", venue: "Webull", f: "in", amt: 250 } // no balance yet
    ] },
    debts: { entries: [
      { d: "2026-09-02", person: "Sam", amt: 80 }, { d: "2026-09-05", person: "Sam", amt: -80 },
      { d: "2026-09-03", person: "Jo", amt: 64.5 }, { d: "2026-09-20", person: "Jo", amt: -0.1 }, { d: "2026-09-21", person: "Jo", amt: -0.2 },
      { d: "2026-09-25", person: "Ann", amt: -42.42 }
    ] },
    bills: { entries: [] }, checks: { entries: [] }
  };
}

// ---- the app's view of the same documents, the way app.js holds them in S ----
function appState(doc) {
  const S = { tx: {}, meta: doc.meta, ledger: doc.ledger.entries, debts: doc.debts.entries };
  for (const k of Object.keys(doc)) if (k.startsWith("tx-")) S.tx[k.slice(3)] = doc[k].items;
  return S;
}
const personTag = (S) => (S.meta.tags || [])[0] || null;

function checkMonths(doc) {
  const L = loadLedger(doc), S = appState(doc);
  const months = monthsWithEntries(L);
  assert.ok(months.length > 0);
  for (const m of months) {
    const e = monthSummary(L, m), a = Money.monthStats(S.tx[m], S.meta.cats, personTag(S)), inc = Money.incomeBy(S.tx[m], S.meta.cats);
    const at = `month ${m}`;
    assert.equal(e.spent, r2(a.spend), `${at}: spent`);
    assert.equal(e.reimbursed_by_friends, r2(a.reimb), `${at}: paid back`);
    assert.equal(e.net_spent, r2(a.net), `${at}: net spent`);
    assert.equal(e.earned_from_work, r2(a.earned), `${at}: earned`);
    assert.equal(e.other_income, r2(a.other), `${at}: other income`);
    assert.equal(e.saved, r2(a.saved), `${at}: saved`);
    // the Earned screen's figures (incomeBy) are the same income
    assert.equal(e.earned_from_work, inc.work, `${at}: work income`);
    assert.equal(e.other_income, inc.other, `${at}: other income (Earned screen)`);
    assert.equal(e.income_total, inc.total, `${at}: income total`);
    // categories: the engine names them without the emoji, so group the app's the same way
    const byCat = Object.create(null);
    for (const [c, v] of Object.entries(a.byCat)) { const k = plainCat(c) || "(no category)"; byCat[k] = (byCat[k] || 0) + v; }
    assert.deepEqual(Object.fromEntries(e.by_category.map((c) => [c.category, c.total])), Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, r2(v)])), `${at}: by category`);
  }
  return months;
}

function checkVenues(doc) {
  const L = loadLedger(doc), S = appState(doc);
  const rows = venueSummary(L);
  assert.ok(rows.length > 0);
  for (const v of rows) {
    const p = Money.venuePnl(S.ledger, v.account, S.meta), at = `${v.account} (${S.meta.basis || "cash"})`;
    assert.equal(v.type, p.type, `${at}: type`);
    assert.equal(v.entries, p.n, `${at}: entries`);
    assert.equal(v.paid_in, r2(p.inn), `${at}: paid in`);
    assert.equal(v.taken_out, r2(p.out), `${at}: taken out`);
    assert.equal(v.net, p.pnl == null ? null : r2(p.pnl), `${at}: result`);
    assert.equal(v.basis === "cash", !!p.cash, `${at}: basis`);
    if (p.cash) {
      assert.equal(v.last_balance ?? null, p.paper, `${at}: last balance`);
      assert.equal(v.still_in_account ?? 0, p.outThere, `${at}: still in the account`);
    } else {
      assert.equal(v.last_balance ?? null, p.bal, `${at}: last balance`);
      assert.equal(/not in the result yet/.test(v.note || ""), p.stale, `${at}: entries after the last balance`);
    }
    assert.equal(v.opening_balance ?? null, p.opening, `${at}: opening balance`);
  }
  return rows;
}

function checkPeople(doc) {
  const L = loadLedger(doc), S = appState(doc);
  const e = accountSummary(L, "people").people, a = Money.personBalances(S.debts);
  assert.deepEqual(Object.fromEntries(e.map((p) => [p.person, p.balance])), Object.fromEntries(Object.entries(a).map(([n, v]) => [n, r2(v)])));
}

test("month totals agree: spent, paybacks, net, income, saved, categories", () => {
  const months = checkMonths(sampleDoc("cash"));
  assert.deepEqual(months, ["2026-08", "2026-09", "2026-10"]); // an empty month has no entries
});

test("the sample hits the awkward cases (so the parity check means something)", () => {
  const S = appState(sampleDoc("cash")), a = Money.monthStats(S.tx["2026-09"], S.meta.cats, "Dates");
  assert.equal(r2(a.spend), 231.1); // 40 + 0 + 33.33 + 150 + 7.77: own shares, PayLater counted when bought
  assert.equal(a.reimb, 80);
  assert.equal(r2(a.other), 212.34); // a gift with no kind and an income category not in the list are both "other"
  assert.equal(a.person, 40);
  const oct = Money.monthStats(S.tx["2026-10"], S.meta.cats, null);
  assert.equal(r2(oct.net), -284.5);
});

test("venue results agree on a cash basis", () => {
  const rows = checkVenues(sampleDoc("cash"));
  assert.equal(rows.length, 6);
});

test("venue results agree on a balance basis", () => {
  const rows = checkVenues(sampleDoc("balance"));
  const by = Object.fromEntries(rows.map((r) => [r.account, r]));
  assert.equal(by.Moomoo.net, 249.85); // 1650.10 - 1000 + 100 - 500.25
  assert.equal(by.IBKR.net, 300); // closed: 2600 - 300 - 2000
  assert.equal(by.Apex.basis, "cash"); // prop firms stay on cash
  assert.equal(by.Webull.net, null);
});

test("people balances agree", () => {
  checkPeople(sampleDoc("cash"));
});

test("subscriptions: the monthly total uses the same per-month rule", () => {
  const doc = sampleDoc("cash"), L = loadLedger(doc);
  const e = accountSummary(L, "subscriptions").monthly_total_active;
  const a = r2(Money.sum(doc.meta.subs.filter((s) => s.active !== false), Money.monthlyEquiv));
  assert.equal(e, a);
  assert.equal(a, 43.1); // 10.98 + 47.88/12 + 28.13
});

// ---- a Money Manager export, through the importer, then both sums ----
const MM_ROWS = [
  ["Period", "Accounts", "Category", "Subcategory", "Note", "SGD", "Income/Expense", "Description", "Amount", "Currency"],
  ["2026-07-01", "Cash", "Food", "Lunch", "chicken rice", 4.5, "Expense", "", 4.5, "SGD"],
  ["2026-07-02", "Cash", "dates", "", "movie with Dates", 32.1, "Expense", "", 32.1, "SGD"],
  ["2026-07-03", "DBS", "💼 Salary", "", "", 2500, "Income", "", 2500, "SGD"],
  ["2026-07-04", "Cash", "Debt payments", "", "Sam paid back", 20, "Income", "", 20, "SGD"],
  ["2026-07-05", "Cash", "🏅 Bonus", "", "ang bao", 88.88, "Income", "", 88.88, "SGD"],
  ["2026-08-01", "DBS", "Moomoo", "", "", 1000, "Transfer-Out", "", 1000, "SGD"],
  ["2026-08-15", "Moomoo", "DBS", "", "", 250.5, "Transfer-Out", "", 250.5, "SGD"],
  ["2026-08-02", "DBS", "Propfirms", "", "Apex eval", 167, "Transfer-Out", "", 167, "SGD"],
  ["2026-08-03", "Cash", "People Owe me Money", "", "Sam (dinner)", 45, "Transfer-Out", "", 45, "SGD"],
  ["2026-08-04", "People Owe me Money", "Cash", "", "Sam (dinner)", 20, "Transfer-Out", "", 20, "SGD"],
  ["2026-08-05", "Cash", "Misplaced balancer", "", "", 3.3, "Transfer-Out", "", 3.3, "SGD"],
  ["2026-08-06", "Misplaced balancer", "Cash", "", "from mummy", 50, "Transfer-Out", "", 50, "SGD"],
  ["2026-08-07", "Cash", "Food", "", "", 0, "Expense", "", 0, "SGD"] // zero: skipped
];
function importedDoc() {
  const r = JSON.parse(JSON.stringify(MM.map(MM_ROWS, null, "Dates"))); // plain objects, out of the sandbox
  // the same steps as app.js applyImport: transactions by month, categories and venues added to meta
  const doc = { meta: { cats: Object.values(r.cats), venues: r.venues, tags: ["Dates"] }, ledger: { entries: r.ledger }, debts: { entries: r.debts }, bills: { entries: [] }, checks: { entries: [] } };
  for (const t of r.tx) { const k = "tx-" + t.d.slice(0, 7); (doc[k] = doc[k] || { items: [] }).items.push(t); }
  return { r, doc };
}

test("Money Manager import reads spending and income rows (it used to stop on the first one)", () => {
  const { r } = importedDoc();
  assert.equal(r.tx.length, 7);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.tx.filter((t) => t.tags.includes("Dates")).map((t) => t.note), ["movie with Dates"]);
  assert.equal(r.ledger.length, 3);
  assert.deepEqual(r.debts.map((d) => [d.person, d.amt]), [["Sam", 45], ["Sam", -20]]);
});

test("an imported ledger gives the same figures in the app and in Ask", () => {
  const { doc } = importedDoc();
  checkMonths(doc);
  checkVenues(doc);
  checkVenues({ ...doc, meta: { ...doc.meta, basis: "balance" } });
  checkPeople(doc);
  const L = loadLedger(doc), jul = monthSummary(L, "2026-07");
  assert.equal(jul.spent, 36.6);
  assert.equal(jul.reimbursed_by_friends, 20); // "Debt payments" maps to Paybacks
  assert.equal(jul.earned_from_work, 2500);
  assert.equal(jul.other_income, 88.88);
  assert.equal(monthSummary(L, "2026-08").other_income, 50); // money from family through the balancer is a bonus
});

// ---- Insights and Home (1.8.6): the figures on those screens, against what Ask works out ----
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;
// the app's categories folded the way Ask names them ("🍜 Food" is "Food")
function plainTotals(byCat) {
  const o = Object.create(null);
  for (const [c, v] of Object.entries(byCat)) { const k = plainCat(c) || "(no category)"; o[k] = (o[k] || 0) + v; }
  return o;
}
const groupTotals = (res) => Object.fromEntries((res.groups || []).map((g) => [g.key, g.total]));
function sameTotals(app, eng, at) {
  for (const k of new Set([...Object.keys(app), ...Object.keys(eng)])) assert.ok(near(r2(app[k] ?? 0), eng[k] ?? 0), `${at} "${k}": app ${r2(app[k] ?? 0)}, Ask ${eng[k] ?? 0}`);
}
function monthRange(a, b) { const out = []; for (let m = a; m <= b; m = Money.addMonth(m, 1)) out.push(m); return out; }
const allRows = (S) => Object.values(S.tx).flat();

function checkInsights(doc, today) {
  const L = loadLedger(doc), S = appState(doc), tag = personTag(S);
  const have = monthsWithEntries(L), ms = monthRange(have[0], today.slice(0, 7));
  const done = have.filter((m) => m < today.slice(0, 7)).slice(-12);
  assert.ok(done.length >= 2, "needs at least two finished months");

  // Overview over the finished months: the totals line and the savings rate Ask is given
  const P = Money.periodStats(S.tx, done, S.meta.cats, tag);
  const ov = overview(L, today);
  const tot = /Totals over [^:]*: income (-?\d+(?:\.\d+)?), net spent (-?\d+(?:\.\d+)?), saved (-?\d+(?:\.\d+)?)/.exec(ov);
  assert.ok(tot, "overview has its totals line");
  const tol = 0.006 * done.length; // Ask adds monthly figures already rounded to cents
  assert.ok(near(P.income, +tot[1], tol), `income: app ${P.income}, Ask ${tot[1]}`);
  assert.ok(near(P.net, +tot[2], tol), `net spent: app ${P.net}, Ask ${tot[2]}`);
  assert.ok(near(P.kept, +tot[3], tol), `saved: app ${P.kept}, Ask ${tot[3]}`);
  const pct = /\((-?\d+)% of income\)/.exec(ov);
  if (pct) assert.equal(P.rate, +pct[1], "savings rate");
  assert.ok(near(P.avgNet, P.net / done.length, 1e-9));

  // the period's spending and money in by category, against search_transactions over the same dates
  const from = done[0], to = done[done.length - 1];
  sameTotals(plainTotals(P.byCat), groupTotals(searchTransactions(L, { from, to, type: "exp", group_by: "category", limit: 0 })), "period spending");
  sameTotals(plainTotals(P.incomeByCat), groupTotals(searchTransactions(L, { from, to, type: "inc", group_by: "category", limit: 0 })), "period money in");

  // "usual" spending: the average of the three months before, against Ask's month totals
  for (const m of ms) {
    const prev = [1, 2, 3].map((k) => Money.addMonth(m, -k)).filter((p) => have.includes(p));
    const pa = Money.priorAvg(S.tx, m, S.meta.cats, tag);
    if (!prev.length) { assert.equal(pa, null, `${m}: no months before`); continue; }
    const ss = prev.map((p) => monthSummary(L, p));
    assert.equal(pa.__n, prev.length);
    assert.ok(near(pa.__net, ss.reduce((a, s) => a + s.net_spent, 0) / prev.length), `${m} usual net: app ${pa.__net}`);
    assert.ok(!Object.keys(pa).includes("__net"), "__net stays off the category keys");
    const avg = {}; for (const s of ss) for (const c of s.by_category) avg[c.category] = (avg[c.category] || 0) + c.total / prev.length;
    const cats = { ...pa }; delete cats.__n;
    sameTotals(plainTotals(cats), avg, `${m} usual by category`);
  }

  // Trends, month by month: spending per category, and income without paybacks
  const td = Money.trendData(allRows(S), ms, "exp", S.meta.cats);
  ms.forEach((m, i) => {
    const app = {}; for (const c of td.cats) app[c.name] = c.m[i];
    const eng = groupTotals(searchTransactions(L, { from: m, to: m, type: "exp", group_by: "category", limit: 0 }));
    // Trends drops a category whose whole range is under 50 cents; Ask keeps it
    const kept = new Set(td.cats.map((c) => plainCat(c.name) || "(no category)"));
    for (const k of Object.keys(eng)) if (!kept.has(k)) delete eng[k];
    sameTotals(plainTotals(app), eng, `${m} trend`);
    for (const c of td.cats) assert.ok(near(c.subs.reduce((a, s) => a + s.m[i], 0), c.m[i], 0.5 + 1e-9), `${m} ${c.name}: subcategories add up`);
  });
  const ti = Money.trendData(allRows(S), ms, "inc", S.meta.cats);
  const incApp = ms.map((_, i) => ti.cats.reduce((a, c) => a + c.m[i], 0));
  ms.forEach((m, i) => assert.ok(near(incApp[i], monthSummary(L, m).income_total), `${m} trend income: app ${incApp[i]}, Ask ${monthSummary(L, m).income_total}`));

  // a tag's lens: per month and in all, against search_transactions with the tag
  if (tag) {
    const lz = Money.lensData(allRows(S), ms, tag, S.meta.cats, S.ledger, S.debts);
    const eng = groupTotals(searchTransactions(L, { tag, type: "exp", group_by: "month", limit: 0 }));
    ms.forEach((m, i) => assert.ok(near(lz.m[i], eng[m] ?? 0), `${tag} ${m}: app ${lz.m[i]}, Ask ${eng[m] ?? 0}`));
    assert.ok(near(lz.total, searchTransactions(L, { tag, type: "exp", limit: 0 }).spent), `${tag} total`);
  }
  // a person's lens: their People balance is the one Ask reports
  for (const p of accountSummary(L, "people").people) {
    if (p.person === "(no name)") continue;
    assert.ok(near(Money.lensData(allRows(S), ms, p.person, S.meta.cats, S.ledger, S.debts).balance, p.balance), `${p.person} balance`);
  }

  // prop firm and poker lines end at the Accounts results Ask reports
  const tr = Money.tradingRuns(S.ledger, S.meta), vs = venueSummary(L);
  const net = (ty) => vs.filter((v) => v.type === ty).reduce((a, v) => a + (v.net ?? 0), 0);
  assert.ok(near(tr.propNet, net("prop")), `prop: app ${tr.propNet}, Ask ${net("prop")}`);
  assert.ok(near(tr.pokerNet, net("poker")), `poker: app ${tr.pokerNet}, Ask ${net("poker")}`);
  if (tr.days.length) { assert.equal(tr.prop[tr.prop.length - 1], tr.propNet); assert.deepEqual([...tr.days], [...tr.days].sort()); assert.equal(new Set(tr.days).size, tr.days.length); }
  return { P, td, tr };
}

test("Insights and Home figures agree with Ask on the sample ledger", () => {
  for (const basis of ["cash", "balance"]) checkInsights(sampleDoc(basis), "2026-11-15");
});

test("Insights and Home figures agree with Ask on a Money Manager import", () => {
  const { doc } = importedDoc();
  const L = loadLedger(doc), last = monthsWithEntries(L).at(-1);
  checkInsights(doc, Money.addMonth(last, 1) + "-15");
});

test("the prop firm result on Insights and Home leaves out a partner's stake, as Accounts does", () => {
  const S = appState(sampleDoc("cash"));
  // Apex: 167 of your own in, 167 of Jo's in, 1200.40 out. Your result is 1033.40, not 866.40.
  const tr = Money.tradingRuns(S.ledger, S.meta);
  assert.equal(tr.propNet, 1033.4);
  assert.equal(tr.propNet, r2(Money.venuePnl(S.ledger, "Apex", S.meta).pnl));
  assert.equal(tr.pokerNet, -64.5);
  const jan = Money.monthTrading(S.ledger, S.meta, "2026-01");
  assert.equal(jan.propFees, 167); // Jo's 167 the next day is theirs
  assert.equal(jan.has, true);
  assert.equal(Money.monthTrading(S.ledger, S.meta, "2026-02").net, 1200.4);
  assert.equal(Money.monthTrading(S.ledger, S.meta, "2026-05").poker, -64.5);
  const jun = Money.monthTrading(S.ledger, S.meta, "2026-06");
  assert.ok(near(jun.brIn, 0.3) && near(jun.brOut, 0.3) && jun.net === 0);
  assert.equal(Money.monthTrading(S.ledger, S.meta, "2026-08").has, false);
});

test("an opening balance on a prop account counts as paid in on its day, on Insights as on Accounts", () => {
  const meta = { venues: { FTMO: { type: "prop" }, Table: { type: "poker" } } };
  const ledger = [
    { d: "2026-01-01", venue: "FTMO", f: "bal", amt: 300 }, // capital carried in
    { d: "2026-01-05", venue: "FTMO", f: "out", amt: 50 },
    { d: "2026-01-09", venue: "FTMO", f: "out", amt: 400 },
    { d: "2026-01-09", venue: "Table", f: "in", amt: 20 },
    { d: "2026-01-20", venue: "FTMO", f: "bal", amt: 9999 }, // a later balance is not money moved
  ];
  const tr = Money.tradingRuns(ledger, meta);
  assert.equal(r2(Money.venuePnl(ledger, "FTMO", meta).pnl), 150);
  assert.equal(tr.propNet, 150);
  assert.deepEqual([...tr.days], ["2026-01-01", "2026-01-05", "2026-01-09"]);
  assert.deepEqual([...tr.prop], [-300, -250, 150]);
  assert.deepEqual([...tr.poker], [0, 0, -20]);
});

test("weekday averages count the days with nothing spent, and stop at today", () => {
  // 2026-11-02 is a Monday
  const exps = [{ d: "2026-11-02", t: "exp", amt: 70 }, { d: "2026-11-09", t: "exp", amt: 30, split: { mine: 10, person: "Sam" } }];
  const w = Money.weekdayAvg(exps, ["2026-11"], "2026-11-10");
  assert.equal(w.avg[0], 40); // two Mondays so far: (70 + 10) / 2
  assert.equal(w.avg[6], 0);
  assert.equal(w.byDay["2026-11-09"], 10);
  assert.equal(Money.weekdayAvg(exps, ["2026-11"], "2026-12-31").avg[0], 80 / 5, "five Mondays in all of November");
});

// ---- the demo (index.html?demo): its made-up ledger is shown as real figures, so it must add up too ----
function demoDoc(today) {
  const S = JSON.parse(JSON.stringify(Demo.build(today))); // out of the vm, so plain objects and arrays
  const doc = { meta: S.meta, ledger: { entries: S.ledger }, debts: { entries: S.debts }, bills: { entries: S.bills }, checks: { entries: S.checks } };
  for (const [m, items] of Object.entries(S.tx)) doc["tx-" + m] = { items };
  return { S, doc };
}

test("the demo ledger gives the same figures in the app and in Ask", () => {
  for (const today of ["2026-11-25", "2027-01-03", "2028-02-29", "2026-07-31"]) {
    const { doc } = demoDoc(today);
    checkMonths(doc); checkVenues(doc); checkPeople(doc);
    checkInsights(doc, today);
  }
});

test("the demo covers six months up to today and nothing after, the same on every device", () => {
  for (const today of ["2026-11-25", "2027-01-03", "2028-02-29"]) {
    const { S } = demoDoc(today);
    const rows = Object.values(S.tx).flat(), dated = [...rows, ...S.ledger, ...S.debts];
    assert.equal(Object.keys(S.tx).length, 6, `${today}: six months`);
    assert.ok(S.tx[today.slice(0, 7)], `${today}: this month has entries`);
    for (const e of dated) assert.ok(e.d <= today, `${today}: ${e.d} is after today`);
    for (const [m, items] of Object.entries(S.tx)) for (const t of items) assert.equal(t.d.slice(0, 7), m, "filed under its month");
    const ids = [...rows, ...S.ledger, ...S.debts].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, "ids are unique");
    assert.equal(S.meta.demo, true, "marked as the demo");
    assert.deepEqual(demoDoc(today).S, S, "built the same way twice");
    // every split dinner Sam owes for is paid back and tied to its income, so nothing looks counted twice
    const paybacks = S.debts.filter((d) => d.amt < 0 && d.person === "Sam");
    for (const d of paybacks) assert.ok(rows.some((t) => t.id === d.txId && t.cat === "↩️ Paybacks"), "payback linked to its income");
    // a payback recorded before today must leave Sam owing nothing for that month
    const sam = S.debts.filter((d) => d.person === "Sam").reduce((a, d) => a + d.amt, 0);
    assert.ok(sam >= -0.005 && sam < 70, `Sam's balance ${sam}`);
  }
});

test("the demo's money moves through a wallet, so Accounts shows no unlinked entries", () => {
  const { S } = demoDoc("2026-11-25");
  for (const t of Object.values(S.tx).flat()) assert.ok(S.meta.accounts.some((a) => a.name === t.acct), `${t.note}: wallet ${t.acct}`);
  for (const e of S.ledger) if (e.f !== "bal") assert.ok(e.acct, `${e.venue} ${e.f}: has a wallet`);
  assert.equal(Money.tradingRuns(S.ledger, S.meta).propNet, 2310.4); // 612.40 + 845 + 1020 payouts - 167 fee
});

test("the demo looks like someone careful with money: counts match, budgets kept, no losing trading month", () => {
  for (const today of ["2026-11-25", "2027-01-03", "2028-02-29", "2026-07-31"]) {
    const { S } = demoDoc(today);
    const D = { tx: Object.values(S.tx).flat(), ledger: S.ledger, debts: S.debts, bills: [] };
    // a count every Sunday night before today, so Home never says a balance check is overdue
    const last = S.checks[S.checks.length - 1].d, gapDays = (Date.parse(today) - Date.parse(last)) / 864e5;
    assert.ok(gapDays >= 1 && gapDays <= 7, `${today}: last count ${last}`);
    // each count is exactly what the entries since the one before say, so no count shows a gap
    for (let i = 1; i < S.checks.length; i++) {
      const p = S.checks[i - 1], c = S.checks[i], mv = Money.walletMoves(D, ["DBS", "Cash"], p, c, today);
      for (const w of ["DBS", "Cash"]) { const gap = c.lines[w] - p.lines[w] - mv.filter((m) => m.acct === w).reduce((a, m) => a + m.amt, 0); assert.ok(Math.abs(gap) < 0.005, `${c.d} ${w}: gap ${gap}`); }
    }
    for (const m of Object.keys(S.tx)) {
      assert.ok(Money.monthTrading(S.ledger, S.meta, m).net >= 0, `${today}: trading lost money in ${m}`);
      for (const b of S.meta.budgets) {
        const cat = b.key.slice(4), spent = S.tx[m].filter((t) => t.t === "exp" && t.cat === cat).reduce((a, t) => a + (t.split ? t.split.mine : t.amt), 0);
        assert.ok(spent <= b.amt, `${today}: ${cat} ${r2(spent)} over its ${b.amt} budget in ${m}`);
      }
    }
    assert.ok(!Object.values(S.meta.venues).some((v) => v.type === "poker"), "no poker");
  }
});

test("what you usually spend by a day of the month counts only the earlier months' entries up to that day", () => {
  const cats = [{ name: "Family", type: "exp" }, { name: "Food", type: "exp" }];
  const row = (d, cat, amt) => ({ id: d + cat, d, t: "exp", amt, cat, tags: [] });
  const tx = { "2026-08": [row("2026-08-01", "Family", 500), row("2026-08-20", "Food", 90)], "2026-09": [row("2026-09-01", "Family", 500), row("2026-09-05", "Food", 30)] };
  const whole = Money.priorAvg(tx, "2026-10", cats, ""), by10 = Money.priorAvg(tx, "2026-10", cats, "", 10);
  assert.equal(whole.Family, 500); assert.equal(whole.Food, 60);
  // by the 10th, money to family has always gone out, so October's $500 on the 1st is the usual amount
  assert.equal(by10.Family, 500); assert.equal(by10.Food, 15); assert.equal(by10.__n, 2);
});

test("on pace for: spent so far plus what earlier months spent after this day, not a straight line", () => {
  const cats = [{ name: "Family", type: "exp" }, { name: "Food", type: "exp" }];
  const row = (d, cat, amt) => ({ id: d + cat, d, t: "exp", amt, cat, tags: [] });
  const month = (m) => [row(m + "-01", "Family", 500), row(m + "-10", "Food", 150), row(m + "-25", "Food", 150)];
  const tx = { "2026-08": month("2026-08"), "2026-09": month("2026-09"), "2026-10": [row("2026-10-01", "Family", 500), row("2026-10-10", "Food", 150)] };
  // on 12 October, $650 spent with $150 of food still to come in a usual month: heading for $800, the usual
  const p = Money.monthPace(tx, "2026-10", cats, "", 12, 31, 650);
  assert.equal(p.proj, 800); assert.equal(p.usual, 800);
  // a straight line would have said 650 / 12 * 31 = $1,679, more than twice the usual
  // with no earlier months, the straight line is all there is
  assert.equal(Money.monthPace({ "2026-10": tx["2026-10"] }, "2026-10", cats, "", 10, 31, 650).proj, 650 / 10 * 31);
});

test("Trends' on pace for a category: so far plus what earlier months added after this day", () => {
  const cats = [{ name: "Rent", type: "exp" }, { name: "Food", type: "exp" }];
  const row = (d, cat, amt, sub) => ({ id: d + cat + amt, d, t: "exp", amt, cat, sub, tags: [] });
  const ms = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const rows = ms.slice(0, 3).flatMap((m) => [row(m + "-01", "Rent", 1200), row(m + "-08", "Food", 100, "Hawker"), row(m + "-28", "Food", 200, "Hawker")])
    .concat([row("2026-10-01", "Rent", 1200), row("2026-10-08", "Food", 100, "Hawker")]);
  const T = Money.trendData(rows, ms, "exp", cats, 25), rent = T.cats.find((c) => c.name === "Rent"), food = T.cats.find((c) => c.name === "Food");
  assert.deepEqual(rent.e, [1200, 1200, 1200, 1200]); assert.deepEqual(food.e, [100, 100, 100, 100]); assert.deepEqual(food.m, [300, 300, 300, 100]);
  assert.deepEqual(food.subs[0].e, food.e);
  const prog = 25 / 31;
  // rent went out on the 1st, so on the 25th October has had its one rent: not 1200 / prog = $1,488
  assert.equal(Money.seriesPace(rent.m, rent.e, 3, 0, prog), 1200);
  // food: $100 so far plus the $200 the earlier months spent after the 25th
  assert.equal(Money.seriesPace(food.m, food.e, 3, 0, prog), 300);
  // only the three months before count, and none before the series started
  assert.equal(Money.seriesPace([900, 0, 300, 300, 100], [0, 0, 100, 100, 100], 4, 2, prog), 300);
  // a series that starts this month has nothing to go on but the straight line
  assert.equal(Money.seriesPace([0, 0, 0, 100], [0, 0, 0, 100], 3, 3, prog), 100 / prog);
  // without uptoDay, trendData leaves e at zero and nothing else changes
  assert.deepEqual(Money.trendData(rows, ms, "exp", cats).cats.find((c) => c.name === "Food").m, food.m);
});
