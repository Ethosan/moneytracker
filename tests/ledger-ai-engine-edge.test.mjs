// Edge cases found by stress-testing the Ask engine (26 Oct 2026): a filter the model wrote
// wrongly must come back as an error, never a silent no-op; a short note word must not pull in a
// category that merely contains its letters; venue results must follow the app's venuePnl rules
// (opening balances, cash vs balance basis); long listings must fit the agent's cap whole; the
// calculator must treat a leading minus like ordinary arithmetic.
import test from "node:test";
import assert from "node:assert/strict";
import { loadLedger, monthSummary, searchTransactions, calculate, venueSummary, overview, RESULT_BUDGET } from "../supabase/functions/ledger-ai/engine.ts";

const base = {
  meta: {
    cats: [{ name: "🍜 Food", type: "exp" }, { name: "🎬 Entertainment", type: "exp" }, { name: "🤝 Paid back", type: "inc", kind: "reimb" }, { name: "💼 Salary", type: "inc", kind: "earned" }],
    accounts: [{ name: "DBS" }],
    venues: { FTMO: { type: "prop" }, IBKR: { type: "broker" }, Old: { type: "broker", closed: true } },
  },
  "tx-2026-10": { items: [
    { id: "a", d: "2026-10-01", t: "exp", amt: 20, cat: "🍜 Food", note: "Claude ai" },
    { id: "b", d: "2026-10-02", t: "exp", amt: 25, cat: "🍜 Food", note: "Claude AI" },
    { id: "c", d: "2026-10-03", t: "exp", amt: 30, cat: "🎬 Entertainment", note: "Cinema" },
    { id: "d", d: "2026-10-04", t: "inc", amt: 15, cat: "🤝 Paid back", note: "Sam" },
    { id: "e", d: "2026-10-05", t: "exp", amt: 9, cat: "🍜 Food", note: "Lunch", sub: "Food delivery" },
  ] },
  ledger: { entries: [
    { venue: "IBKR", d: "2025-01-05", f: "bal", amt: 5000 },           // opening capital, before any deposit
    { venue: "IBKR", d: "2025-03-01", f: "in", amt: 1000 },
    { venue: "IBKR", d: "2025-06-01", f: "out", amt: 400 },
    { venue: "IBKR", d: "2025-06-01", f: "bal", amt: 6200 },           // same day as the withdrawal: counted after it
    { venue: "IBKR", d: "2025-07-01", f: "in", amt: 100 },             // after the last balance
    { venue: "IBKR", d: "2025-08-01", f: "in", amt: 50, who: "Sam" },  // a partner's money, not mine
    { venue: "FTMO", d: "2026-10-08", f: "in", amt: 100 },
    { venue: "FTMO", d: "2026-10-18", f: "out", amt: 250 },
    { venue: "Old", d: "2025-01-01", f: "in", amt: 300 },
  ] },
};
const L = loadLedger(base);

test("a malformed date, type or group_by is an error the model can correct", () => {
  assert.throws(() => searchTransactions(L, { from: "October 2026" }), /from must be YYYY-MM-DD or YYYY-MM/);
  assert.throws(() => searchTransactions(L, { to: "2026/10/01" }), /to must be/);
  assert.throws(() => searchTransactions(L, { type: "spendings" }), /type must be exp, inc, xfer, adj or all/);
  assert.throws(() => searchTransactions(L, { group_by: "weekday" }), /group_by must be one of/);
  // plain-English synonyms still work
  assert.equal(searchTransactions(L, { type: "expense", limit: 0 }).matched, 4);
  assert.equal(searchTransactions(L, { type: "Spending", limit: 0 }).spent, 84);
  assert.equal(searchTransactions(L, { type: "income", limit: 0 }).income, 15);
  assert.equal(searchTransactions(L, { type: "", limit: 0 }).matched, 5);
  assert.equal(searchTransactions(L, { from: "", to: "", limit: 0 }).matched, 5);
});

test("a note word matches a category only as a whole word", () => {
  // "ai" is inside Entertainment and Paid back; neither is about AI
  const ai = searchTransactions(L, { note: "ai", type: "exp", limit: 0 });
  assert.equal(ai.note_matched_category, undefined);
  assert.equal(ai.matched, 2);
  assert.equal(ai.spent, 45);
  // "food" is a whole word of the Food category and of the "Food delivery" subcategory
  const food = searchTransactions(L, { note: "food", type: "exp", limit: 0 });
  assert.deepEqual(food.note_matched_category, ["🍜 Food", "Food delivery"]);
  assert.equal(food.spent, 54);
  // "delivery" is a whole word of the subcategory in use
  assert.deepEqual(searchTransactions(L, { note: "delivery", limit: 0 }).note_matched_category, ["Food delivery"]);
});

test("month_summary merges the spellings of a note", () => {
  const s = monthSummary(L, "2026-10");
  const claude = s.top_notes.filter((n) => /^claude ai$/i.test(n.note));
  assert.equal(claude.length, 1);
  assert.deepEqual(claude[0], { note: "Claude ai", category: "Food", total: 45, count: 2 });
});

test("venue results follow the app's venuePnl rules on a cash basis", () => {
  const [ftmo, ibkr, old] = [venueSummary(L, "FTMO")[0], venueSummary(L, "IBKR")[0], venueSummary(L, "Old")[0]];
  assert.equal(ftmo.net, 150);
  // opening balance counts as paid in; the partner's 50 does not; the result is cash in vs out
  assert.equal(ibkr.basis, "cash");
  assert.equal(ibkr.opening_balance, 5000);
  assert.equal(ibkr.paid_in, 6100);
  assert.equal(ibkr.taken_out, 400);
  assert.equal(ibkr.net, -5700);
  assert.equal(ibkr.still_in_account, 5700);
  assert.equal(ibkr.last_balance, 6200);
  assert.equal(ibkr.entries, 6);
  // a closed broker has nothing still in it
  assert.equal(old.still_in_account, undefined);
  assert.equal(old.net, -300);
  assert.match(overview(L, "2026-10-26"), /broker IBKR: paid in 6100 \(incl. opening balance 5000\), taken out 400, result -5700, still in the account 5700, last balance 6200/);
});

test("venue results follow the app's balance basis when meta.basis is not cash", () => {
  const L2 = loadLedger({ ...base, meta: { ...base.meta, basis: "accrual" } });
  const ibkr = venueSummary(L2, "IBKR")[0];
  // last balance 6200 - opening 5000 + 400 out - 1000 in between them = 600; the 100 after it is stale
  assert.equal(ibkr.basis, "balance");
  assert.equal(ibkr.net, 600);
  assert.equal(ibkr.paid_in, 1100);
  assert.match(ibkr.note, /after the last balance/);
  // prop firms stay on a cash basis whatever the setting
  assert.equal(venueSummary(L2, "FTMO")[0].net, 150);
  // a closed account with no balance: result = out - in - opening
  assert.equal(venueSummary(L2, "Old")[0].net, -300);
  // an open account with no balance has no result on this basis
  const L3 = loadLedger({ ...base, meta: { ...base.meta, basis: "accrual" }, ledger: { entries: [{ venue: "New", d: "2026-01-01", f: "in", amt: 100 }] } });
  assert.equal(venueSummary(L3, "New")[0].net, null);
  assert.match(overview(L2, "2026-10-26"), /ACCOUNTS \(balance basis/);
});

test("a long listing keeps its markdown and drops the row ids to fit the cap", () => {
  const items = [];
  for (let i = 0; i < 200; i++) items.push({ id: "r" + i, d: "2026-0" + (1 + (i % 9)) + "-" + String(1 + (i % 28)).padStart(2, "0"), t: "exp", amt: 10 + i, cat: "🍜 Food", note: "Lunch at a place with a long name number " + i, acct: "DBS" });
  const LL = loadLedger({ meta: base.meta, "tx-2026": { items } });
  const r = searchTransactions(LL, { type: "exp", group_by: "month", limit: 200 });
  assert.ok(JSON.stringify(r).length <= RESULT_BUDGET);
  assert.equal(r.matched, 200);
  assert.equal(r.rows.length, 0);
  assert.match(r.rows_note, /200 rows are listed in rows_markdown/);
  assert.equal(r.rows_markdown.split("\n").length, 202);
  assert.equal(r.groups.length, 9);
  // a short listing keeps its ids
  const s = searchTransactions(LL, { type: "exp", limit: 25 });
  assert.equal(s.rows.length, 25);
  assert.equal(s.rows[0].d, "2026-09-27"); // newest first
  // the keys come in reading order: markdown before rows
  const keys = Object.keys(s);
  assert.ok(keys.indexOf("rows_markdown") < keys.indexOf("rows"));
});

test("calculate: a leading minus binds looser than a power", () => {
  assert.equal(calculate("-2^2"), -4);
  assert.equal(calculate("(-2)^2"), 4);
  assert.equal(calculate("2^-2"), 0.25);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("3--2"), 5);
  assert.equal(calculate("$1,000 - $250.50"), 749.5);
  assert.equal(calculate("2 × 3 ÷ 4"), 1.5);
  assert.throws(() => calculate("1e3"));
  assert.throws(() => calculate("9^9^9"));
});

test("a category name with the emoji moved or missing still matches", () => {
  assert.equal(searchTransactions(L, { category: "Food 🍜", type: "exp", limit: 0 }).spent, 54);
  assert.equal(searchTransactions(L, { category: "food", type: "exp", limit: 0 }).spent, 54);
  assert.equal(searchTransactions(L, { category: "🍜 Food", type: "exp", limit: 0 }).spent, 54);
});

test("a narrowed search carries the whole period's totals, for shares", () => {
  const r = searchTransactions(L, { category: "Food", type: "exp", from: "2026-10", to: "2026-10", limit: 0 });
  assert.deepEqual({ ...r.period_totals, note: undefined }, { from: "2026-10-01", to: "2026-10-31", all_spending: 84, all_income: 0, friends_paid_back: 15, net_spending: 69, note: undefined });
  assert.equal(searchTransactions(L, { type: "exp", limit: 0 }).period_totals, undefined);
});

test("a short note term matches whole words only, and | lists alternatives", () => {
  const LL = loadLedger({ meta: base.meta, "tx-2026-10": { items: [
    { id: "n1", d: "2026-10-01", t: "exp", amt: 20, cat: "🍜 Food", note: "Claude AI" },
    { id: "n2", d: "2026-10-02", t: "exp", amt: 30, cat: "🎬 Entertainment", note: "OpenAI credits" },
    { id: "n3", d: "2026-10-03", t: "exp", amt: 15, cat: "🎬 Entertainment", note: "Grab to Alaina" },
    { id: "n4", d: "2026-10-04", t: "exp", amt: 25, cat: "🎬 Entertainment", note: "Haircut" },
    { id: "n5", d: "2026-10-05", t: "exp", amt: 5, cat: "🍜 Food", note: "GrabFood lunch" },
  ] } });
  // "ai" is inside Alaina and Haircut; only the whole word counts
  const ai = searchTransactions(LL, { note: "ai", type: "exp", limit: 0 });
  assert.equal(ai.matched, 1);
  assert.equal(ai.spent, 20);
  // alternatives: any of them, with a per-term breakdown
  const many = searchTransactions(LL, { note: "Claude|OpenAI|AI", type: "exp", limit: 0 });
  assert.equal(many.matched, 2);
  assert.equal(many.spent, 50);
  assert.deepEqual(many.by_term, [{ term: "claude", count: 1, total: 20 }, { term: "openai", count: 1, total: 30 }, { term: "ai", count: 1, total: 20 }]);
  // a longer term still matches inside words
  assert.equal(searchTransactions(LL, { note: "grab", type: "exp", limit: 0 }).matched, 2);
  assert.equal(searchTransactions(LL, { note: " | ", type: "exp", limit: 0 }).matched, 5);
});
