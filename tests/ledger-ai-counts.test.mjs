// Balance counts are moments, not days (supabase/functions/ledger-ai/engine.ts, mirrored in js/dates.js).
// The bug these pin: a count of 2,500 made in the afternoon, then a 1,200 hotel paid the same evening,
// used to read as "the hotel was already inside the count", so the balance stayed at 2,500 the next
// day. An entry logged after the count's moment is after it; the id carries when it was logged.
import test from "node:test";
import assert from "node:assert/strict";
import { loadLedger, accountSummary, runTool, whenMade, afterCount, fmtTime } from "../supabase/functions/ledger-ai/engine.ts";

// an app id made at a given moment: 'a' + Date.now() in base 36 + a random tail
const idAt = (iso) => "a" + Date.parse(iso).toString(36) + "k3x9q";
const DAY = "2026-10-24";
const T = (hm) => `${DAY}T${hm}:00+08:00`; // Singapore clock time on the count day

const count = { id: idAt(T("14:30")), d: DAY, total: 2500, lines: { DBS: 2500 }, exp: { DBS: 2480 } };
const doc = {
  meta: { cats: [{ name: "🍜 Food", type: "exp" }, { name: "🏨 Travel", type: "exp" }], accounts: [{ name: "DBS" }] },
  checks: { entries: [count] },
  "tx-2026-10": { items: [
    { id: idAt(T("12:10")), d: DAY, t: "exp", amt: 20, cat: "🍜 Food", note: "Lunch", acct: "DBS" },
    { id: idAt(T("19:05")), d: DAY, t: "exp", amt: 1200, cat: "🏨 Travel", note: "Hotel experience", acct: "DBS" },
    { id: idAt("2026-10-25T09:00:00+08:00"), d: DAY, t: "exp", amt: 8, cat: "🍜 Food", note: "Logged next morning, dated the count day", acct: "DBS" },
    { id: idAt("2026-10-25T09:30:00+08:00"), d: "2026-10-25", t: "exp", amt: 15, cat: "🍜 Food", note: "Next day", acct: "DBS" },
    { id: "b9", d: DAY, t: "exp", amt: 5, cat: "🍜 Food", note: "No time known", acct: "DBS" },
  ] },
};

test("whenMade reads the moment out of an app id, and an explicit `at` wins", () => {
  assert.equal(whenMade({ id: idAt(T("14:30")) }), Date.parse(T("14:30")));
  assert.equal(whenMade({ id: idAt(T("14:30")), at: T("09:00") }), Date.parse(T("09:00")));
  assert.equal(whenMade({ id: "b9" }), null);
  assert.equal(whenMade({ id: "a1" }), null);
  assert.equal(whenMade(null), null);
});

test("afterCount: dates decide across days, the moment decides on the count day, no time means before", () => {
  assert.equal(afterCount(count, { d: "2026-10-25", id: "b1" }), true);
  assert.equal(afterCount(count, { d: "2026-10-23", id: idAt(T("23:00")) }), false);
  assert.equal(afterCount(count, { d: DAY, id: idAt(T("12:10")) }), false, "lunch before the count was inside it");
  assert.equal(afterCount(count, { d: DAY, id: idAt(T("19:05")) }), true, "the hotel paid after the count was not");
  assert.equal(afterCount(count, { d: DAY, id: "b9" }), false, "no time on the entry: the old end-of-day rule");
  assert.equal(afterCount({ id: "c1", d: DAY }, { d: DAY, id: idAt(T("19:05")) }), false, "no time on the count: the old rule");
  // an explicit at can flip a same-day entry to the other side of the count
  assert.equal(afterCount(count, { d: DAY, id: idAt(T("19:05")), at: T("14:29") }), false);
  assert.equal(afterCount(count, { d: DAY, id: idAt(T("12:10")), at: T("14:31") }), true);
});

test("fmtTime shows the count's clock time in the owner's zone", () => {
  assert.equal(fmtTime(Date.parse(T("14:30")), "Asia/Singapore"), "14:30");
  assert.equal(fmtTime(Date.parse(T("14:30")), "Not/AZone"), "14:30"); // falls back to Singapore
  assert.equal(fmtTime(null, "Asia/Singapore"), null);
});

test("balance_counts gives each count's time and the same-day entries with their side", () => {
  const L = loadLedger(doc); L.tz = "Asia/Singapore";
  const r = accountSummary(L, "balance_counts");
  assert.equal(r.counts.length, 1);
  const c = r.counts[0];
  assert.equal(c.time, "14:30");
  assert.equal(c.total, 2500);
  assert.deepEqual(c.counted, { DBS: 2500 });
  const side = Object.fromEntries(c.same_day_entries.map((e) => [e.note, e.side]));
  assert.deepEqual(side, { "Lunch": "before", "Hotel experience": "after", "Logged next morning, dated the count day": "after", "No time known": "before" });
  const hotel = c.same_day_entries.find((e) => e.note === "Hotel experience");
  assert.equal(hotel.logged_at, "19:05");
  assert.equal(hotel.wallet, "DBS");
  assert.equal(hotel.kind, "spending");
  assert.ok(c.same_day_entries.every((e) => e.note !== "Next day"), "entries on other days are not listed");
  assert.match(r.note, /moment it was saved/);
  // through the tool runner too
  const t = runTool(L, "account_summary", { section: "balance_counts" });
  assert.equal(t.result.counts[0].same_day_entries.length, 4);
});

test("balance_counts sorts two counts on one day by their moment", () => {
  const later = { id: idAt(T("20:00")), d: DAY, total: 1300, lines: { DBS: 1300 } };
  const L = loadLedger({ ...doc, checks: { entries: [later, count] } });
  const r = accountSummary(L, "balance_counts");
  assert.deepEqual(r.counts.map((c) => c.time), ["14:30", "20:00"]);
  // the hotel (19:05) is after the first count and before the second
  assert.equal(r.counts[0].same_day_entries.find((e) => e.note === "Hotel experience").side, "after");
  assert.equal(r.counts[1].same_day_entries.find((e) => e.note === "Hotel experience").side, "before");
});
