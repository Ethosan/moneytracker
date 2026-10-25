// The Ask chat's exact-numbers engine (supabase/functions/ledger-ai/engine.ts), run here by Node
// with its types stripped. These pin the rules the app's own screens use: split bills count the
// owner's share, fee rows and prop-firm mirrors count as spending, reimbursements reduce net
// spending, saved = income - net spending, and the model's arithmetic goes through calculate().
import test from "node:test";
import assert from "node:assert/strict";
import { loadLedger, monthSummary, searchTransactions, calculate, overview, runTool, accountSummary } from "../supabase/functions/ledger-ai/engine.ts";

const doc = {
  meta: {
    cats: [{ name: "🍜 Food", type: "exp" }, { name: "🚇 Transport", type: "exp" }, { name: "💼 Salary", type: "inc", kind: "earned" }, { name: "🤝 Paid back", type: "inc", kind: "reimb" }, { name: "🎁 Gifts", type: "inc" }, { name: "📉 Prop firms", type: "exp" }],
    accounts: [{ name: "DBS" }, { name: "Cash" }, { name: "Card", liability: true }],
    venues: { FTMO: { type: "prop" } },
    subs: [{ name: "Spotify", amt: 11.98, cycle: 1 }, { name: "iCloud", amt: 36, cycle: 12, active: false }],
  },
  "tx-2026-09": { items: [
    { id: "a1", d: "2026-09-03", t: "exp", amt: 40, cat: "🍜 Food", note: "Dinner", acct: "DBS", split: { mine: 20, person: "Sam" } },
    { id: "a2", d: "2026-09-10", t: "inc", amt: 3000, cat: "💼 Salary", note: "Pay" },
    { id: "a3", d: "2026-09-12", t: "exp", amt: 2.5, cat: "🚇 Transport", note: "MRT", acct: "Cash" },
  ] },
  "tx-2026-10": { items: [
    { id: "b1", d: "2026-10-01", t: "exp", amt: 12.5, cat: "🍜 Food", note: "Lunch at Koufu", acct: "DBS", tags: ["work"] },
    { id: "b2", d: "2026-10-02", t: "exp", amt: 30, cat: "🍜 Food", note: "Groceries", acct: "DBS" },
    { id: "b3", d: "2026-10-05", t: "inc", amt: 15, cat: "🤝 Paid back", note: "Sam dinner" },
    { id: "b4", d: "2026-10-06", t: "inc", amt: 3000, cat: "💼 Salary", note: "Pay" },
    { id: "b5", d: "2026-10-07", t: "inc", amt: 50, cat: "🎁 Gifts", note: "Birthday" },
    { id: "pf_x", propOf: "x", d: "2026-10-08", t: "exp", amt: 100, cat: "📉 Prop firms", note: "FTMO: 10k eval" },
    { id: "f1", feeOf: "b2", d: "2026-10-09", t: "exp", amt: 1, cat: "💳 Finance fees", note: "Interest" },
    { id: "x1", d: "2026-10-10", t: "xfer", amt: 200, from: "DBS", to: "Cash" },
    { id: "b6", d: "2026-10-20", t: "exp", amt: 8, cat: "🚇 Transport", note: "Grab", pm: "later", plp: "GrabPay Later" },
  ] },
  ledger: { entries: [
    { id: "x", venue: "FTMO", d: "2026-10-08", f: "in", amt: 100, note: "10k eval" },
    { id: "y", venue: "FTMO", d: "2026-10-18", f: "out", amt: 250, note: "payout" },
  ] },
  debts: { entries: [{ d: "2026-10-03", person: "Sam", amt: 20, note: "dinner" }, { d: "2026-10-05", person: "Sam", amt: -15, note: "paid back" }] },
};
const L = loadLedger(doc);

test("monthSummary follows the app's Month tab rules", () => {
  const s = monthSummary(L, "2026-10");
  // own-share spending: 12.5 + 30 + 100 (prop mirror) + 1 (fee) + 8 = 151.5
  assert.equal(s.spent, 151.5);
  assert.equal(s.reimbursed_by_friends, 15);
  assert.equal(s.net_spent, 136.5);
  assert.equal(s.earned_from_work, 3000);
  assert.equal(s.other_income, 50);
  assert.equal(s.saved, 3050 - 136.5);
  assert.deepEqual(s.by_category[0], { category: "Prop firms", total: 100, count: 1 });
  assert.equal(s.by_category.find((c) => c.category === "Food").total, 42.5);
  assert.equal(s.transactions, 9);
});

test("a split bill counts only the owner's share", () => {
  const s = monthSummary(L, "2026-09");
  assert.equal(s.spent, 22.5);
  assert.equal(s.saved, 3000 - 22.5);
});

test("searchTransactions filters, totals and groups exactly", () => {
  const food = searchTransactions(L, { type: "exp", category: "food", from: "2026-10", to: "2026-10" });
  assert.equal(food.matched, 2);
  assert.equal(food.spent, 42.5);
  assert.equal(food.rows[0].id, "b2"); // newest first, editable rows carry ids
  const byMonth = searchTransactions(L, { type: "exp", category: "Food", group_by: "month", limit: 0 });
  assert.deepEqual(byMonth.groups, [{ key: "2026-09", total: 20, count: 1 }, { key: "2026-10", total: 42.5, count: 2 }]);
  assert.equal(byMonth.rows.length, 0);
  const koufu = searchTransactions(L, { note: "koufu" });
  assert.equal(koufu.matched, 1);
  assert.equal(koufu.rows[0].tags[0], "work");
  const later = searchTransactions(L, { wallet: "paylater" });
  assert.equal(later.total_of_matched, 8);
  const mirror = searchTransactions(L, { note: "FTMO" });
  assert.equal(mirror.rows[0].id, undefined, "mirrors cannot be edited from the chat");
  const sam = searchTransactions(L, { person: "sam" });
  assert.equal(sam.rows[0].my_share, 20);
  const big = searchTransactions(L, { type: "exp", min_amount: 25, sort: "largest" });
  assert.deepEqual(big.rows.map((r) => r.amt), [100, 30]);
});

test("calculate handles precedence, percent and bad input", () => {
  assert.equal(calculate("2+3*4"), 14);
  assert.equal(calculate("(612.3+184.2)/1284.5*100").toFixed(2), "62.01");
  assert.equal(calculate("10%"), 0.1);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("-5+2"), -3);
  assert.equal(calculate("$1,284.50 - $612.30"), 672.2);
  assert.throws(() => calculate("1/0"), /zero/);
  assert.throws(() => calculate("alert(1)"), /allowed/);
  assert.throws(() => calculate("(1+2"), /brackets/);
});

test("overview reports each month and averages over complete months only", () => {
  const text = overview(L, "2026-10-26");
  assert.match(text, /2026-09: spent 22.5, income 3000, saved 2977.5/);
  assert.match(text, /2026-10 \(so far\): spent 151.5 \(friends paid back 15, net 136.5\), income 3050 \(work 3000, other 50\), saved 2913.5/);
  assert.match(text, /Averages over the last 1 complete month \(2026-09 to 2026-09\): income 3000, net spent 22.5, saved 2977.5 \(99% of income\)/);
  assert.match(text, /prop FTMO: paid in 100, taken out 250, net 150/);
});

test("account sections and tool labels", () => {
  assert.deepEqual(accountSummary(L, "people").people[0], { person: "Sam", balance: 5, entries: [{ d: "2026-10-03", amt: 20, note: "dinner" }, { d: "2026-10-05", amt: -15, note: "paid back" }] });
  assert.equal(accountSummary(L, "subscriptions").monthly_total_active, 11.98);
  const r = runTool(L, "search_transactions", { type: "exp", category: "food", from: "2026-10-01", to: "2026-10-31" });
  assert.equal(r.label, "Looked up spending food 2026-10-01 to 2026-10-31: 2 rows, 42.5");
  assert.equal(runTool(L, "calculate", { expression: "42.5 / 151.5 * 100" }).result.result, 28.05);
  assert.throws(() => runTool(L, "nope", {}), /Unknown tool/);
  assert.throws(() => runTool(L, "month_summary", { month: "October" }), /YYYY-MM/);
});

test("a note word that names a category matches the category too, and says so", () => {
  // "spent on food" searched as note=Food: the Food rows match even though no note says food
  const r = searchTransactions(L, { note: "food", type: "exp", from: "2026-10", to: "2026-10", group_by: "day" });
  assert.equal(r.matched, 2);
  assert.equal(r.total_of_matched, 42.5);
  assert.deepEqual(r.note_matched_category, ["🍜 Food"]);
  assert.match(r.hint, /category name/);
  // a word that is not a category still matches notes only
  const g = searchTransactions(L, { note: "grab", type: "exp" });
  assert.equal(g.matched, 1);
  assert.equal(g.note_matched_category, undefined);
});

test("a search without a type that mixes spending and income carries a caution", () => {
  const r = searchTransactions(L, { from: "2026-10", to: "2026-10", group_by: "category", limit: 0 });
  assert.match(r.caution, /mix spending/);
  const e = searchTransactions(L, { from: "2026-10", to: "2026-10", type: "exp", limit: 0 });
  assert.equal(e.caution, undefined);
});
