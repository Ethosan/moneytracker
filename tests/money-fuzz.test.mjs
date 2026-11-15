// Stress test: thousands of random, deliberately messy ledgers, each run through the app's own cleaning
// and sums (js/money.js, as app.js normalize() and the screens use them) and through Ask's engine
// (supabase/functions/ledger-ai/engine.ts, which reads the stored documents straight from the database).
// They must agree on every total, the totals must hold their own arithmetic, nothing may crash, and
// names the owner typed (a category called "__proto__", a person called "constructor") must never
// reach JavaScript's built-in objects. The generator is seeded, so a failure repeats exactly:
// rerun with FUZZ_SEED=<seed> (and FUZZ_RUNS=<n>) to reproduce or to search further.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { loadLedger, monthSummary, monthsWithEntries, venueSummary, accountSummary, searchTransactions, overview, plainCat, r2 } from "../supabase/functions/ledger-ai/engine.ts";

const C = {};
vm.runInNewContext(fs.readFileSync(new URL("../js/money.js", import.meta.url), "utf8"), C);
const { Money } = C;

const SEED = Number(process.env.FUZZ_SEED || 20261115), RUNS = Number(process.env.FUZZ_RUNS || 1500);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- the awkward values ----
const HOSTILE = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype"];
const AMOUNTS = [0.01, 0.1, 0.2, 0.3, 1.005, 2.675, 19.99, 33.33, 99.99, 100, 1234.56, 1e9 + 0.01, 1e12, 0.005, 0, -0, -42.5, -0.01,
  "12.50", "1,234.56", " 7 ", "abc", "", null, undefined, NaN, Infinity, -Infinity, true, [5], { amt: 5 }, "1e3", "0x10"];
const CAT_NAMES = ["🍜 Food", "🍔 Food", "Food", "🚌 Transport", "💝 Dates", "🍜", "", "Café ☕", "日本 食べ物", ...HOSTILE];
const INC_CATS = [["💼 Salary", "earned"], ["📖 Tutoring", "earned"], ["↩️ Paybacks", "reimb"], ["🏅 Bonus", "other"], ["🎁 Gift", undefined], ["constructor", "earned"], ["__proto__", "reimb"]];
const PEOPLE = ["Sam", "Jo", "Ann", "", ...HOSTILE];
const VENUES = ["Moomoo", "IBKR", "Apex", "Poker", "Crypto", "Webull", ...HOSTILE];
const TYPES = ["broker", "crypto", "prop", "poker", undefined, "weird"];

function gen(seed) {
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)], chance = (p) => R() < p, int = (n) => Math.floor(R() * n);
  // mostly clean amounts in cents, with every kind of junk mixed in
  const amt = () => (chance(0.7) ? Math.round((R() * (chance(0.1) ? 1e7 : 500)) * 100) / 100 || 0.01 : pick(AMOUNTS));
  const cats = [...CAT_NAMES.map((n) => ({ name: n, type: "exp" })), ...INC_CATS.map(([n, k]) => ({ name: n, type: "inc", ...(k ? { kind: k } : {}) }))];
  if (chance(0.2)) cats.push({ name: "💼 Salary", type: "inc", kind: "other" }); // a duplicate name: the first one wins
  if (chance(0.1)) cats.push(null);
  const months = ["2025-12", "2026-01", "2026-02", "2026-03"].filter(() => chance(0.7));
  const doc = { meta: { cats, basis: pick(["cash", "balance", undefined]), tags: ["Dates"], venues: {}, accounts: [{ name: "Cash" }] } };
  let id = 0;
  for (const m of months) {
    const items = [];
    for (let i = int(30); i > 0; i--) {
      const t = pick(["exp", "exp", "exp", "inc", "inc", "xfer", "adj", "zzz"]);
      const d = chance(0.04) ? pick(["2026-1-5", "", null, 20260105, "2026-02-31", "garbage"]) : `${chance(0.05) ? pick(months) : m}-${String(1 + int(28)).padStart(2, "0")}`;
      const x = { id: "x" + id++, d, t, amt: amt(), cat: t === "inc" ? pick(INC_CATS)[0] : pick(CAT_NAMES), note: pick(["lunch", "Lunch ", "", "__proto__", "constructor", "grab|food"]) };
      if (t === "exp" && chance(0.25)) x.split = chance(0.85) ? { mine: chance(0.8) ? amt() : pick([-1, 0, 1e15, "5", "x", null]), person: pick(PEOPLE) } : pick(["junk", 5, null, []]);
      if (chance(0.5)) x.tags = chance(0.9) ? [pick(["Dates", "Trip", "__proto__", "constructor"])].concat(chance(0.2) ? [7, null] : []) : pick(["Dates", 5, null, {}]);
      if (t === "exp" && chance(0.1)) { x.pm = "later"; x.inst = { n: 1 + int(6), fee: pick([0, 1.5, "2"]) }; }
      items.push(x);
    }
    if (chance(0.03)) items.push(null, 7, "row", { d: `${m}-02` });
    doc["tx-" + m] = { items };
  }
  if (chance(0.05)) doc["tx-2026-09"] = { items: "not a list" };
  const entries = [];
  for (let i = int(25); i > 0; i--) {
    const venue = pick(VENUES);
    if (!Object.hasOwn(doc.meta.venues, venue) && chance(0.8)) Object.defineProperty(doc.meta.venues, venue, { value: { type: pick(TYPES), ...(chance(0.2) ? { closed: true } : {}) }, enumerable: true, writable: true, configurable: true });
    entries.push({ id: "l" + id++, d: chance(0.03) ? pick([null, ""]) : `2026-0${1 + int(3)}-0${1 + int(3)}`, venue, f: pick(["in", "in", "out", "bal", "bal", "x"]), amt: amt(), ...(chance(0.15) ? { who: pick(["me", "Jo", "__proto__"]) } : {}) });
  }
  if (chance(0.05)) entries.push(null, "x");
  doc.ledger = { entries };
  const debts = [];
  for (let i = int(15); i > 0; i--) debts.push({ id: "d" + id++, d: chance(0.03) ? null : `2026-01-${String(1 + int(28)).padStart(2, "0")}`, person: pick(PEOPLE), amt: chance(0.5) ? -amt() : amt() });
  if (chance(0.05)) debts.push(null, 0, { person: "Sam", amt: 5 });
  doc.debts = { entries: debts };
  doc.bills = { entries: [] }; doc.checks = { entries: [] };
  doc.meta.subs = [{ name: "a", amt: amt(), cycle: pick([1, 3, 12, 0, undefined]) }];
  return doc;
}

// ---- the app's path: what app.js does on load (normalize) and on its screens ----
function appState(raw) {
  const S = { tx: {}, meta: raw.meta, ledger: Money.cleanLedger(raw.ledger && raw.ledger.entries), debts: Money.cleanDebts(raw.debts && raw.debts.entries) };
  for (const k of Object.keys(raw)) {
    if (!k.startsWith("tx-")) continue;
    const items = raw[k] && raw[k].items;
    for (const t of Array.isArray(items) ? items : []) if (Money.cleanTx(t)) (S.tx[t.d.slice(0, 7)] = S.tx[t.d.slice(0, 7)] || []).push(t);
  }
  return S;
}
// what the database hands back: JSON (NaN and Infinity come back as null, undefined keys vanish)
const clone = (x) => JSON.parse(JSON.stringify(x));
const builtins = () => [Object.prototype, Object, Array.prototype, Function.prototype, String.prototype, Number.prototype]
  .map((o) => Object.getOwnPropertyNames(o).sort().join(","));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const near = (a, b) => Math.abs(a - b) < 0.005 + 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const plainObj = (o) => JSON.parse(JSON.stringify(o));

// One ledger, every check; returns the problems found (empty when all is well).
function check(seed) {
  const problems = [];
  const bad = (kind, detail) => problems.push({ kind, detail });
  const raw = gen(seed);
  const before = builtins();
  let L, S;
  try { L = loadLedger(clone(raw)); } catch (e) { bad("engine crashed loading", e.message); return problems; }
  try { S = appState(clone(raw)); } catch (e) { bad("app crashed cleaning", e.message); return problems; }
  const months = new Set([...monthsWithEntries(L), ...Object.keys(S.tx)]);
  for (const m of months) {
    let e, a, inc;
    try { e = monthSummary(L, m); } catch (err) { bad("engine month crashed", err.message); continue; }
    try { a = Money.monthStats(S.tx[m] || [], S.meta.cats, "Dates"); inc = Money.incomeBy(S.tx[m] || [], S.meta.cats); } catch (err) { bad("app month crashed", err.message); continue; }
    for (const [k, v] of Object.entries({ spend: a.spend, earned: a.earned, other: a.other, reimb: a.reimb, net: a.net, saved: a.saved })) if (!isNum(v)) bad("app month total not a number", `${m} ${k}=${v}`);
    for (const [k, v] of Object.entries(e)) if (typeof v === "number" && !isNum(v)) bad("engine month total not a number", `${m} ${k}=${v}`);
    const pairs = [["spent", e.spent, a.spend], ["reimbursed", e.reimbursed_by_friends, a.reimb], ["net", e.net_spent, a.net], ["earned", e.earned_from_work, a.earned], ["other income", e.other_income, a.other], ["saved", e.saved, a.saved], ["income total", e.income_total, inc.total]];
    for (const [k, ev, av] of pairs) if (!near(ev, r2(av))) bad("month totals differ", `${m} ${k}: engine ${ev}, app ${r2(av)}`);
    // the totals' own arithmetic
    if (!near(a.net, a.spend - a.reimb) || !near(a.saved, a.earned + a.other - a.net)) bad("app month arithmetic", m);
    if (!near(Object.values(a.byCat).reduce((x, y) => x + y, 0), a.spend)) bad("categories don't add up to spent (app)", `${m}: ${JSON.stringify(plainObj(a.byCat))} vs ${a.spend}`);
    if (!near(e.by_category.reduce((x, c) => x + c.total, 0), e.spent)) bad("categories don't add up to spent (engine)", `${m}: ${e.by_category.map((c) => c.category + " " + c.total).join(", ")} vs ${e.spent}`);
    if (!near(inc.total, inc.work + inc.other)) bad("income arithmetic", m);
    if (a.spend < -1e-9) bad("negative spending", `${m}: ${a.spend}`);
    for (const t of S.tx[m] || []) { const v = Money.ea(t); if (!(v >= 0 && v <= t.amt)) bad("own share outside 0..amount", JSON.stringify(t)); }
    const byCat = Object.create(null);
    for (const [c, v] of Object.entries(a.byCat)) { const k = plainCat(c) || "(no category)"; byCat[k] = (byCat[k] || 0) + v; }
    const eCats = Object.fromEntries(e.by_category.map((c) => [c.category, c.total]));
    for (const k of new Set([...Object.keys(byCat), ...Object.keys(eCats)])) if (!near(eCats[k] ?? 0, r2(byCat[k] ?? 0))) bad("category totals differ", `${m} "${k}": engine ${eCats[k]}, app ${r2(byCat[k] ?? 0)}`);
    // the order rows were saved in must not matter
    const shuffled = (S.tx[m] || []).slice().reverse(), b = Money.monthStats(shuffled, S.meta.cats, "Dates");
    if (!near(b.spend, a.spend) || !near(b.saved, a.saved)) bad("order changes the month", m);
  }
  let vs = [];
  try { vs = venueSummary(L); } catch (err) { bad("engine venues crashed", err.message); }
  const names = new Set(S.ledger.filter((e) => e.venue).map((e) => String(e.venue)));
  if (vs.length !== names.size) bad("venue lists differ", `engine ${vs.map((v) => v.account).join("/")} app ${[...names].join("/")}`);
  for (const v of vs) {
    let p;
    try { p = Money.venuePnl(S.ledger, v.account, S.meta); } catch (err) { bad("app venue crashed", err.message); continue; }
    const at = `${v.account} ${S.meta.basis || "cash"}/${p.type}`;
    if (!isNum(p.inn) || !isNum(p.out)) bad("app venue total not a number", `${at}: in ${p.inn} out ${p.out}`);
    if (!isNum(v.paid_in) || !isNum(v.taken_out)) bad("engine venue total not a number", `${at}: in ${v.paid_in} out ${v.taken_out}`);
    if (v.type !== p.type) bad("venue type differs", `${at}: engine ${v.type}`);
    if (!near(v.paid_in, r2(p.inn)) || !near(v.taken_out, r2(p.out))) bad("venue in/out differs", `${at}: engine ${v.paid_in}/${v.taken_out}, app ${r2(p.inn)}/${r2(p.out)}`);
    if ((v.net == null) !== (p.pnl == null) || (v.net != null && !near(v.net, r2(p.pnl)))) bad("venue result differs", `${at}: engine ${v.net}, app ${p.pnl}`);
    if (p.cash && !near(p.pnl, p.out - p.inn)) bad("cash result isn't out minus in", at);
  }
  try {
    const e = accountSummary(L, "people").people, a = Money.personBalances(S.debts);
    const eo = Object.fromEntries(e.map((x) => [x.person === "(no name)" ? "" : x.person, x.balance]));
    for (const k of new Set([...Object.keys(a), ...Object.keys(eo)])) if (!near(eo[k] ?? 0, r2(a[k] ?? 0))) bad("people balances differ", `"${k}": engine ${eo[k]}, app ${a[k]}`);
  } catch (err) { bad("people crashed", err.message); }
  // the other things Ask runs on the same ledger must not crash or touch built-ins either
  try {
    overview(L, "2026-03-15");
    for (const g of ["category", "note", "tag", "wallet", "subcategory", "month"]) searchTransactions(L, { type: "all", group_by: g });
    for (const s of ["subscriptions", "budgets", "paylater", "venues", "categories", "balance_counts"]) accountSummary(L, s);
  } catch (err) { bad("engine lookup crashed", err.message); }
  if (builtins().join("|") !== before.join("|")) bad("built-in objects changed (prototype pollution)", builtins().map((s, i) => s === before[i] ? "" : s).filter(Boolean).join(" ; ").slice(0, 200));
  return problems;
}

test(`fuzz: ${RUNS} messy ledgers agree between the app and Ask, and break nothing (seed ${SEED})`, () => {
  const seen = new Map();
  let failed = 0;
  for (let i = 0; i < RUNS; i++) {
    const seed = SEED + i, ps = check(seed);
    if (ps.length) failed++;
    for (const p of ps) { const s = seen.get(p.kind) || { n: 0, seed, detail: p.detail }; s.n++; seen.set(p.kind, s); }
  }
  const report = [...seen].map(([k, s]) => `${k}: ${s.n} time(s), first at FUZZ_SEED=${s.seed}: ${String(s.detail).slice(0, 220)}`).join("\n");
  assert.equal(failed, 0, `${failed} of ${RUNS} ledgers had problems:\n${report}`);
});

export { gen, check, appState };
