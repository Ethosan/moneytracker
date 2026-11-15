// The app and the Ask chat must give the same figures. The app's sums live in js/money.js; the chat's
// engine (supabase/functions/ledger-ai/engine.ts) has its own copy, since the Edge Function cannot load
// a browser script. This runs the same ledgers through both and fails when any total differs.
// Also runs a Money Manager export through js/mm-import.js and checks the imported ledger the same way.
// Node 22+ (engine.ts loads with type stripping, as in the other ledger-ai tests).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { loadLedger, monthSummary, monthsWithEntries, venueSummary, accountSummary, plainCat, r2 } from "../supabase/functions/ledger-ai/engine.ts";

const read = (f) => fs.readFileSync(new URL("../js/" + f, import.meta.url), "utf8");
const C = {};
vm.runInNewContext(read("money.js") + "\n" + read("mm-import.js"), C);
const { Money, MM } = C;

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
