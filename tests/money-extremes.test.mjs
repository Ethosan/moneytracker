// Extreme cases for the money maths, named one by one: junk amounts, hostile names, old stored rows the
// app never re-saved, huge ledgers, and the calculator Ask uses. The random version of these is
// tests/money-fuzz.test.mjs; this file says what each rule is.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as E from "../supabase/functions/ledger-ai/engine.ts";

const read = (f) => fs.readFileSync(new URL("../js/" + f, import.meta.url), "utf8");
const C = {};
vm.runInNewContext(read("money.js") + "\n" + read("mm-import.js"), C);
const { Money, MM } = C;
const J = (x) => JSON.parse(JSON.stringify(x)); // plain copies of objects made in the sandbox
const builtins = () => [Object.prototype, Object, Array.prototype, Function.prototype, String.prototype]
  .map((o) => Object.getOwnPropertyNames(o).sort().join(",")).join("|");
const CATS = [{ name: "🍜 Food", type: "exp" }, { name: "💼 Salary", type: "inc", kind: "earned" }, { name: "↩️ Paybacks", type: "inc", kind: "reimb" }];

// ---- cleaning: the app and the engine apply the same rules to the same stored row ----
const ROWS = [
  [{ d: "2026-01-05", t: "exp", amt: 12.5 }, { amt: 12.5 }],
  [{ d: "2026-01-05", t: "exp", amt: "12.50" }, { amt: 12.5 }], // text from an old import
  [{ d: "2026-01-05", t: "exp", amt: "1,234.56" }, { amt: 1 }], // parseFloat stops at the comma: as the app has always read it
  [{ d: "2026-01-05", t: "exp", amt: -42.5 }, { amt: 42.5 }], // a sign is dropped: the type says which way money went
  [{ d: "2026-01-05", t: "exp", amt: 1.005 }, { amt: 1 }], // cents, as stored in binary
  [{ d: "2026-01-05", t: "exp", amt: 0.004 }, null], // rounds to nothing: not a row
  [{ d: "2026-01-05", t: "exp", amt: 0 }, null],
  [{ d: "2026-01-05", t: "exp", amt: "abc" }, null],
  [{ d: "2026-01-05", t: "exp", amt: NaN }, null],
  [{ d: "2026-01-05", t: "exp", amt: Infinity }, null],
  [{ d: "2026-01-05", t: "exp", amt: 1e11 }, { amt: 1e11 }], // S$100 billion: the largest amount read
  [{ d: "2026-01-05", t: "exp", amt: 1e11 + 1 }, null],
  [{ d: "2026-01-05", t: "exp", amt: "4111111111111111" }, null], // a pasted card number
  [{ d: "2026-01-05", t: "exp", amt: null }, null],
  [{ d: "2026-01-05", t: "exp", amt: [5] }, { amt: 5 }], // parseFloat([5]) is 5: harmless, kept as the app always did
  [{ d: "2026-1-5", t: "exp", amt: 5 }, null], // not YYYY-MM-DD
  [{ d: 20260105, t: "exp", amt: 5 }, null],
  [{ t: "exp", amt: 5 }, null],
  [null, null], ["row", null], [7, null],
  [{ d: "2026-01-05", t: "exp", amt: 90, split: { mine: 30, person: "Sam" } }, { amt: 90, split: { mine: 30, person: "Sam" } }],
  [{ d: "2026-01-05", t: "exp", amt: 90, split: { mine: 500, person: "Sam" } }, { amt: 90, split: { mine: 90, person: "Sam" } }], // a share can't exceed the bill
  [{ d: "2026-01-05", t: "exp", amt: 90, split: { mine: "30", person: "Sam" } }, { amt: 90, split: { mine: 30, person: "Sam" } }],
  [{ d: "2026-01-05", t: "exp", amt: 90, split: { mine: "x", person: "Sam" } }, { amt: 90, split: { mine: 0, person: "Sam" } }],
  [{ d: "2026-01-05", t: "exp", amt: 90, split: { mine: 30 } }, { amt: 90, split: undefined }], // nobody to owe: not a split
  [{ d: "2026-01-05", t: "exp", amt: 90, split: "junk" }, { amt: 90, split: undefined }],
  [{ d: "2026-01-05", t: "exp", amt: 90, tags: "Dates" }, { amt: 90, tags: [] }],
  [{ d: "2026-01-05", t: "exp", amt: 90, tags: ["Dates", 7, null, "Trip"] }, { amt: 90, tags: ["Dates", "Trip"] }],
];
test("cleaning a stored row: the app (money.js) and Ask (engine.ts) apply the same rules", () => {
  for (const [row, want] of ROWS) {
    const a = row && typeof row === "object" ? structuredClone(row) : row, e = row && typeof row === "object" ? structuredClone(row) : row;
    const ka = Money.cleanTx(a), ke = E.cleanTx(e), label = JSON.stringify(row);
    assert.equal(ka, !!want, `app keeps ${label}?`);
    assert.equal(ke, !!want, `engine keeps ${label}?`);
    if (!want) continue;
    assert.deepEqual(J(a), J(e), `same row after cleaning: ${label}`);
    for (const k of Object.keys(want)) assert.deepEqual(J(a)[k], want[k], `${label}: ${k}`);
    if (row.amt !== 0 && Money.ea(a) > a.amt) assert.fail(`own share above the bill: ${label}`);
  }
});

test("People and investment entries are cleaned the same way", () => {
  const debts = [{ d: "2026-01-01", person: "Sam", amt: "20" }, { d: "2026-01-02", person: "Sam", amt: -5.004 }, null, { person: "Jo", amt: 5 }, { d: "2026-01-03", person: "Jo", amt: "x" }];
  assert.deepEqual(J(Money.cleanDebts(structuredClone(debts))), J(E.cleanDebts(structuredClone(debts))));
  assert.deepEqual(J(Money.cleanDebts(structuredClone(debts))).map((d) => d.amt), [20, -5, 0]);
  const led = [{ d: "2026-01-01", venue: "A", f: "in", amt: 0 }, { d: "2026-01-01", venue: "A", f: "bal", amt: 0 }, { d: "2026-01-02", venue: "A", f: "out", amt: "50" }, { d: "2026-01-03", venue: "A", f: "in", amt: -5 }];
  assert.deepEqual(J(Money.cleanLedger(structuredClone(led))), J(E.cleanLedger(structuredClone(led))));
  assert.deepEqual(J(Money.cleanLedger(structuredClone(led))).map((e) => e.f + e.amt), ["bal0", "out50"]); // a zero balance stays; zero or negative money in does not
  assert.deepEqual(J(Money.cleanDebts("not a list")), []);
});

test("an old stored month the app never re-saved gives Ask the same totals as the app", () => {
  // text amounts, a negative, a share above the bill, a junk split, tags as text: all once possible in stored data
  const doc = { meta: { cats: CATS }, "tx-2026-01": { items: [
    { d: "2026-01-02", t: "exp", amt: "10.10", cat: "🍜 Food" },
    { d: "2026-01-03", t: "exp", amt: -20, cat: "🍜 Food", tags: "Dates" },
    { d: "2026-01-04", t: "exp", amt: 90, cat: "🍜 Food", split: { mine: 500, person: "Sam" } },
    { d: "2026-01-05", t: "exp", amt: 15, cat: "🍜 Food", split: "junk" },
    { d: "2026-01-06", t: "inc", amt: "3000", cat: "💼 Salary" },
    { d: "2026-01-07", t: "inc", amt: 0, cat: "↩️ Paybacks" },
  ] } };
  const L = E.loadLedger(structuredClone(doc)), s = E.monthSummary(L, "2026-01");
  const rows = structuredClone(doc["tx-2026-01"].items).filter(Money.cleanTx), a = Money.monthStats(rows, CATS, null);
  assert.equal(s.spent, 135.1); // 10.10 + 20 + 90 (capped at the bill) + 15
  assert.equal(s.spent, Money.r2(a.spend));
  assert.equal(s.earned_from_work, 3000);
  assert.equal(s.saved, Money.r2(a.saved));
  assert.equal(s.transactions, 5);
});

// ---- names that are also JavaScript's built-in property names ----
const HOSTILE = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];
test("categories, tags and people named like built-ins add up like any other name, in both", () => {
  const items = HOSTILE.flatMap((n, i) => [
    { id: "e" + i, d: "2026-02-0" + (i + 1), t: "exp", amt: 10 + i, cat: n, note: n, tags: [n] },
    { id: "f" + i, d: "2026-02-1" + (i + 1), t: "exp", amt: 1, cat: n, note: n, tags: [n], split: { mine: 0.5, person: n } },
  ]);
  const cats = [...CATS, ...HOSTILE.map((n) => ({ name: n, type: "exp" }))];
  const doc = { meta: { cats }, "tx-2026-02": { items }, debts: { entries: HOSTILE.map((n, i) => ({ d: "2026-02-01", person: n, amt: i + 1 })) } };
  const S = structuredClone(items).filter(Money.cleanTx);
  const a = Money.monthStats(S, cats, null);
  for (const [i, n] of HOSTILE.entries()) {
    assert.equal(a.byCat[n], 10 + i + 0.5, `app category ${n}`);
    assert.equal(a.byTag[n], 10 + i + 0.5, `app tag ${n}`);
  }
  assert.equal(Object.keys(a.byCat).length, HOSTILE.length);
  const L = E.loadLedger(structuredClone(doc)), s = E.monthSummary(L, "2026-02");
  assert.deepEqual(s.by_category.map((c) => [c.category, c.total]).sort(), HOSTILE.map((n, i) => [n, 10 + i + 0.5]).sort());
  assert.deepEqual(s.top_notes.map((c) => c.note).sort(), HOSTILE.slice().sort());
  assert.deepEqual(J(Money.personBalances(doc.debts.entries)), Object.fromEntries(HOSTILE.map((n, i) => [n, i + 1])));
  assert.deepEqual(E.accountSummary(L, "people").people.map((p) => [p.person, p.balance]).sort(), HOSTILE.map((n, i) => [n, i + 1]).sort());
  for (const g of ["category", "note", "tag", "subcategory"]) {
    const r = E.searchTransactions(L, { type: "exp", group_by: g });
    assert.equal(r.groups.reduce((x, y) => x + y.total, 0), r.spent, `grouped by ${g}`);
  }
  E.overview(L, "2026-02-20");
});

test("an Ask filter word like 'constructor' is an error to correct, not a silent match", () => {
  const L = E.loadLedger({ meta: { cats: CATS }, "tx-2026-01": { items: [{ d: "2026-01-02", t: "exp", amt: 5, cat: "🍜 Food" }] } });
  for (const t of ["constructor", "toString", "__proto__"]) assert.throws(() => E.searchTransactions(L, { type: t }), /type must be/);
});

test("nothing above touched JavaScript's built-in objects", () => {
  const before = builtins();
  const L = E.loadLedger({ meta: { cats: CATS, venues: JSON.parse('{"__proto__": {"type": "prop"}, "constructor": {"type": "poker"}}') },
    "tx-2026-01": { items: HOSTILE.map((n, i) => ({ d: "2026-01-0" + (i + 1), t: "exp", amt: 5, cat: n, note: n, tags: [n], acct: n, sub: n })) },
    ledger: { entries: HOSTILE.map((n) => ({ d: "2026-01-01", venue: n, f: "in", amt: 5, who: n })) },
    debts: { entries: HOSTILE.map((n) => ({ d: "2026-01-01", person: n, amt: 5 })) } });
  for (const g of ["category", "note", "tag", "wallet", "subcategory", "type", "month"]) E.searchTransactions(L, { type: "all", group_by: g, note: "__proto__|constructor" });
  E.overview(L, "2026-01-20");
  for (const s of ["venues", "people", "categories", "subscriptions", "budgets", "paylater", "balance_counts"]) E.accountSummary(L, s);
  E.venueEntries(L, "__proto__");
  const v = Object.fromEntries(E.venueSummary(L).map((r) => [r.account, r.type]));
  assert.equal(v.__proto__, "prop"); // the stored venue settings are read as the owner's, by name
  assert.equal(v.constructor, "poker");
  assert.equal(v.toString, "broker");
  const p = Money.venuePnl(J(L.led), "__proto__", L.meta);
  assert.equal(p.type, "prop");
  assert.equal(builtins(), before);
  assert.equal(({}).total, undefined);
  assert.equal(({}).count, undefined);
});

test("a Money Manager file with built-in names imports them as plain names", () => {
  const before = builtins();
  const r = J(MM.map([
    ["Period", "Accounts", "Category", "Subcategory", "Note", "SGD", "Income/Expense"],
    ["2026-07-01", "Cash", "constructor", "", "x", 4.5, "Expense"],
    ["2026-07-02", "Cash", "__proto__", "", "y", 3, "Income"],
    ["2026-07-03", "DBS", "toString", "", "z", 50, "Transfer-Out"], // not a known venue: skipped, not Object.prototype.toString
    ["2026-07-04", "DBS", "Moomoo", "", "", 100, "Transfer-Out"],
  ], null, null));
  assert.deepEqual(r.tx.map((t) => [t.cat, t.amt]), [["constructor", 4.5], ["__proto__", 3]]);
  assert.deepEqual(Object.keys(r.cats).sort(), ["__proto__", "constructor"]);
  assert.equal(r.cats.__proto__.kind, "other");
  assert.deepEqual(r.ledger.map((e) => [e.venue, e.f, e.amt]), [["Moomoo", "in", 100]]);
  assert.equal(r.skipped, 1);
  assert.equal(builtins(), before);
});

// ---- values the app holds in memory before anything is saved (not JSON: NaN, Infinity, objects) ----
test("junk the app could hold in memory never produces NaN or a crash after cleaning", () => {
  const junk = [NaN, Infinity, -Infinity, undefined, null, "", "abc", {}, [], true, Symbol.iterator.description, 1e308, -1e308, 5e-324];
  const rows = junk.flatMap((v, i) => [
    { d: "2026-03-01", t: "exp", amt: v, cat: "🍜 Food", split: { mine: v, person: "Sam" }, tags: v },
    { d: "2026-03-02", t: "inc", amt: v, cat: "💼 Salary" },
    { d: "2026-03-03", t: "exp", amt: 5, split: { mine: v, person: "Sam" } },
  ]).filter(Money.cleanTx);
  const a = Money.monthStats(rows, CATS, "Dates"), inc = Money.incomeBy(rows, CATS);
  for (const v of [a.spend, a.earned, a.other, a.reimb, a.net, a.saved, inc.total, ...Object.values(a.byCat)]) assert.ok(Number.isFinite(v), `finite: ${v}`);
  const led = Money.cleanLedger(junk.map((v) => ({ d: "2026-03-01", venue: "A", f: "in", amt: v })).concat(junk.map((v) => ({ d: "2026-03-02", venue: "A", f: "bal", amt: v }))));
  const p = Money.venuePnl(led, "A", { basis: "balance" });
  for (const v of [p.inn, p.out, p.pnl]) assert.ok(Number.isFinite(v), `venue finite: ${v}`);
  assert.equal(Money.monthStats(undefined, undefined, undefined).spend, 0);
  assert.equal(Money.catKind({ length: 1, 0: { name: "x", kind: "earned" } }, "x"), "other"); // not a list
  assert.equal(Money.venueType(undefined, "x"), "broker");
});

// ---- size and precision ----
function bigLedger(n) {
  let s = 7; const R = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const items = {}, cents = { exp: 0n, inc: 0n };
  for (let i = 0; i < n; i++) {
    const m = `20${20 + Math.floor(i / (n / 72) / 12)}-${String(1 + (Math.floor(i / (n / 72)) % 12)).padStart(2, "0")}`;
    const c = Math.floor(R() * 2_000_000) + 1, t = R() < 0.8 ? "exp" : "inc"; // up to S$20,000 a row, in cents
    cents[t] += BigInt(c);
    (items["tx-" + m] = items["tx-" + m] || { items: [] }).items.push({ id: "a" + i, d: m + "-" + String(1 + (i % 28)).padStart(2, "0"), t, amt: c / 100, cat: t === "exp" ? "🍜 Food" : "💼 Salary", note: ["Grab ride", "GrabFood", "Claude AI", "chair", "lunch"][i % 5], tags: i % 3 ? [] : ["Dates"] });
  }
  return { doc: { meta: { cats: CATS }, ...items }, cents };
}

test("120,000 transactions over six years: exact to the cent, and quick", () => {
  const { doc, cents } = bigLedger(120_000);
  let t0 = performance.now();
  const L = E.loadLedger(doc);
  const tLoad = performance.now() - t0; t0 = performance.now();
  const ov = E.overview(L, "2026-12-31");
  const tOverview = performance.now() - t0; t0 = performance.now();
  const r = E.searchTransactions(L, { type: "all", note: "ai|grab|chair", group_by: "note", limit: 200 });
  const tSearch = performance.now() - t0; t0 = performance.now();
  const S = {}; for (const x of L.tx) (S[x.d.slice(0, 7)] = S[x.d.slice(0, 7)] || []).push(x);
  let spend = 0, income = 0;
  for (const m of Object.keys(S)) { const a = Money.monthStats(S[m], CATS, "Dates"); spend += a.spend; income += a.earned; }
  const tApp = performance.now() - t0;
  // the whole six years, added in floating point month by month, still lands on the exact cent
  assert.equal(Math.round(spend * 100), Number(cents.exp));
  assert.equal(Math.round(income * 100), Number(cents.inc));
  const all = E.searchTransactions(L, { type: "exp", limit: 0 });
  assert.equal(Math.round(all.spent * 100), Number(cents.exp));
  assert.ok(ov.includes("EXACT MONTHLY TOTALS"));
  assert.ok(r.matched > 0 && r.groups.length > 0);
  assert.ok(JSON.stringify(r).length <= E.RESULT_BUDGET, "a big result still fits what the model reads");
  const limits = { tLoad: 3000, tOverview: 5000, tSearch: 5000, tApp: 2000 }, took = { tLoad, tOverview, tSearch, tApp };
  for (const k of Object.keys(limits)) assert.ok(took[k] < limits[k], `${k} took ${Math.round(took[k])} ms`);
});

test("one huge amount and many tiny ones keep their cents", () => {
  const rows = [{ d: "2026-01-01", t: "exp", amt: 9_999_999.99 }].concat(Array.from({ length: 10_000 }, (_, i) => ({ d: "2026-01-02", t: "exp", amt: 0.01 }))).filter(Money.cleanTx);
  assert.equal(Money.r2(Money.monthStats(rows, CATS, null).spend), 10_000_099.99);
  const L = E.loadLedger({ meta: { cats: CATS }, "tx-2026-01": { items: rows } });
  assert.equal(E.monthSummary(L, "2026-01").spent, 10_000_099.99);
});

// ---- the calculator ----
test("calculate: plain arithmetic only, with clear limits", () => {
  assert.equal(E.r2(E.calculate("(612.3+184.2)/1284.5*100")), 62.01);
  assert.equal(E.calculate("15%*200"), 30);
  assert.equal(E.calculate("-2^2"), -4);
  assert.equal(E.calculate("1,234.50 + $5"), 1239.5);
  for (const bad of ["alert(1)", "process.exit()", "constructor", "1;2", "[1]", "2*_3", "1e400", "Infinity", "NaN", "a=1", "`1`"]) assert.throws(() => E.calculate(bad), /Only numbers/, bad);
  assert.throws(() => E.calculate("2**3")); // two operators in a row: not arithmetic it reads
  assert.throws(() => E.calculate("9^9^9"), /not a number/);
  assert.throws(() => E.calculate("1/0"), /Division by zero/);
  assert.throws(() => E.calculate("(".repeat(101) + "1" + ")".repeat(101)), /nested brackets/);
  assert.equal(E.calculate("(".repeat(100) + "1" + ")".repeat(100)), 1);
  assert.throws(() => E.calculate(Array(700).fill("1.5").join("+")), /too long/);
  assert.throws(() => E.calculate("(1+2"), /Unbalanced|Expected/);
  assert.throws(() => E.calculate(""), /Only numbers/);
});

// ---- applying a change Ask proposed: checked again in the app, since stored chats are replayed ----
test("Apply refuses a proposed change that would put bad data in the ledger", () => {
  const cats = [...CATS, { name: "💼 Bonus", type: "inc", kind: "other" }];
  const cur = { id: "a1", d: "2026-01-05", t: "exp", amt: 12, cat: "🍜 Food" };
  const ok = (c, x = cur) => Money.changeOk(c, x, cats);
  assert.equal(ok({ op: "edit", amt: 15.5 }), true);
  assert.equal(ok({ op: "edit", note: "lunch with Sam", d: "2024-02-29" }), true);
  assert.equal(ok({ op: "add", amt: 4.2, cat: "🍜 Food", t: "exp", d: "2026-01-06" }, null), true);
  assert.equal(ok({ op: "delete" }), true);
  for (const [c, why] of [
    [{ op: "edit", amt: "12.5" }, "an amount as text"], [{ op: "edit", amt: 0 }, "zero"], [{ op: "edit", amt: -5 }, "negative"],
    [{ op: "edit", amt: NaN }, "NaN"], [{ op: "edit", amt: Infinity }, "Infinity"], [{ op: "edit", amt: 1e7 }, "S$10 million"],
    [{ op: "edit", d: "2026-02-30" }, "no such day"], [{ op: "edit", d: "2025-02-29" }, "not a leap year"], [{ op: "edit", d: "garbage" }, "not a date"], [{ op: "edit", d: 20260105 }, "a number"],
    [{ op: "edit", t: "xfer" }, "a transfer"], [{ op: "edit", t: "constructor" }, "a junk type"],
    [{ op: "edit", cat: "Nope" }, "a category that doesn't exist"], [{ op: "edit", cat: "constructor" }, "a built-in name"],
    [{ op: "edit", cat: "💼 Salary" }, "spending into an income category"], [{ op: "edit", t: "inc" }, "income in a spending category"],
    [{ op: "edit", note: { toString: 1 } }, "a note that isn't text"], [{ op: "rename" }, "an unknown operation"], [null, "nothing"],
    [{ op: "add", amt: 5 }, "an add with no category"], [{ op: "add", cat: "🍜 Food" }, "an add with no amount"],
  ]) assert.equal(ok(c, c && c.op === "add" ? null : cur), false, why);
  assert.equal(ok({ op: "edit", amt: 5 }, null), false, "an edit of an entry that's gone");
  assert.equal(ok({ op: "delete" }, null), false, "a delete of an entry that's gone");
});
