// PayLater bills and wallet balances from js/money.js: hand-worked cases, the junk stored data can hold,
// and seeded random ledgers checked against rules that must always hold. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// money.js uses the date helpers in dates.js, which the page loads first: load both into one sandbox.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
const C = {};
vm.createContext(C);
for (const f of ['dates.js', 'money.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), C, { filename: f });
const M = C.Money;
const J = (x) => JSON.parse(JSON.stringify(x));
const cents = (n) => Math.round(n * 100);
const deq = (a, b, m) => assert.deepEqual(J(a), b, m);

// ---------- PayLater ----------
test('statement periods: start on the cycle day, end the day before the next one', () => {
  assert.equal(M.periodStart('2026-11-14', 1), '2026-11-01');
  assert.equal(M.periodStart('2026-11-14', 15), '2026-10-15');
  assert.equal(M.periodStart('2026-11-15', 15), '2026-11-15');
  assert.equal(M.periodStart('2026-01-03', 15), '2025-12-15'); // across a year
  assert.equal(M.periodStart('2026-11-14', 31), '2026-10-28'); // the cycle day is 1 to 28
  assert.equal(M.periodStart('2026-11-14', 'junk'), '2026-11-01');
  assert.equal(M.periodEnd('2026-10-15'), '2026-11-14');
  assert.equal(M.periodEnd('2026-02-01'), '2026-02-28');
  assert.equal(M.periodEnd('2028-02-01'), '2028-02-29');
  assert.equal(M.periodEnd('2026-12-01'), '2026-12-31');
});

test('instalments: one share a period, the fee included, the last share takes the rounding', () => {
  const t = { d: '2026-11-20', amt: 100, inst: { n: 3, fee: 0.01 } };
  deq(J(M.instShares(t, 1)), [
    { from: '2026-11-01', amt: 33.34, k: 1, n: 3 },
    { from: '2026-12-01', amt: 33.34, k: 2, n: 3 },
    { from: '2027-01-01', amt: 33.33, k: 3, n: 3 }
  ]);
  // starting the period after the purchase
  deq(M.instShares({ ...t, inst: { n: 3, start: 1 } }, 1).map((s) => s.from), ['2026-12-01', '2027-01-01', '2027-02-01']);
});

test('instalments: junk counts and fees from stored data add up anyway', () => {
  const t = { d: '2026-11-20', amt: 100 };
  // a fee saved as text used to be glued on: 100 + "2" was "1002"
  assert.equal(M.sum(M.instShares({ ...t, inst: { n: 4, fee: '2' } }, 1), (s) => s.amt), 102);
  // a fraction used to make 5 shares that came to more than the bill
  const frac = M.instShares({ ...t, inst: { n: 4.5 } }, 1);
  assert.equal(frac.length, 4);
  assert.equal(cents(M.sum(frac, (s) => s.amt)), 10000);
  // a huge count used to loop a billion times
  const huge = M.instShares({ ...t, inst: { n: 1e9 } }, 1);
  assert.equal(huge.length, 60);
  assert.equal(cents(M.sum(huge, (s) => s.amt)), 10000);
  assert.equal(M.instShares({ ...t, inst: { n: '4' } }, 1).length, 4);
  assert.equal(M.instShares({ ...t, inst: { n: -3, fee: 'x' } }, 1).length, 1);
  assert.equal(M.instShares({ ...t, inst: { n: 4, fee: Infinity } }, 1).reduce((a, s) => a + s.amt, 0), 100);
});

const later = (d, amt, extra) => ({ t: 'exp', pm: 'later', d, amt, ...extra });
const TXS = [
  later('2026-11-03', 30),
  later('2026-11-28', 20),
  later('2026-12-02', 10),
  later('2026-11-10', 90, { inst: { n: 3 } }),
  later('2026-11-05', 50, { plp: 'Atome' }), // another provider
  { t: 'exp', d: '2026-11-05', amt: 999, acct: 'DBS' }, // not PayLater
  { t: 'inc', pm: 'later', d: '2026-11-05', amt: 999 } // not spending
];

test('bills: what each period is made of, and what you still owe', () => {
  assert.equal(M.billTotal(TXS, { from: '2026-11-01' }, 1), 80); // 30 + 20 + the first 30 share
  assert.equal(M.billTotal(TXS, { from: '2026-12-01' }, 1), 40);
  assert.equal(M.billTotal(TXS, { from: '2027-01-01' }, 1), 30);
  deq(J(M.laterPeriods(TXS, [], 'GrabPay Later', 1)), ['2027-01-01', '2026-12-01', '2026-11-01']);
  assert.equal(M.laterOwed(TXS, [], 'GrabPay Later', 1), 150);
  assert.equal(M.laterOwed(TXS, [], 'Atome', 1), 50);
  const items = M.laterItems(TXS, '2026-11-01', 'GrabPay Later', 1);
  deq(items.map((t) => t.d), ['2026-11-03', '2026-11-10', '2026-11-28']);
  assert.equal(items[1]._inst, '1 of 3');
  assert.equal(items[1]._full, 90);
});

test('a bill paid in 4: the schedule, what is covered, and what is left', () => {
  const bill = { from: '2026-11-01', n: 4, fee: 2, payments: [{ d: '2026-12-28', amt: 20.5 }, { d: '2027-01-28', amt: 20.5 }] };
  assert.equal(M.billDue(TXS, bill, 1), 82);
  assert.equal(M.billPaid(bill), 41);
  assert.equal(M.billLeft(TXS, bill, 1), 41);
  deq(J(M.billSchedule(TXS, bill, 1)), [
    { i: 0, d: '2026-12-28', amt: 20.5, part: 20.5, paid: true },
    { i: 1, d: '2027-01-28', amt: 20.5, part: 20.5, paid: true },
    { i: 2, d: '2027-02-28', amt: 20.5, part: 0, paid: false },
    { i: 3, d: '2027-03-28', amt: 20.5, part: 0, paid: false }
  ]);
  // the November bill replaces November's purchases in what you owe
  assert.equal(M.laterOwed(TXS, [bill], 'GrabPay Later', 1), 111); // 41 + 40 + 30
  // paid too much: every payment covered, and the overpayment shows as owing less
  const over = { ...bill, payments: [{ d: '2026-12-01', amt: 100 }] };
  assert.equal(M.billLeft(TXS, over, 1), -18);
  assert.ok(M.billSchedule(TXS, over, 1).every((s) => s.paid));
  // junk payments count as nothing, not NaN
  assert.equal(M.billPaid({ payments: [{ amt: 'abc' }, null, { amt: 5 }] }), 5);
  assert.equal(M.billDue(TXS, { from: '2026-11-01', fee: 'abc' }, 1), 80);
  assert.equal(M.billSchedule(TXS, { from: '2026-11-01', n: 1e9 }, 1).length, 60);
});

// ---------- wallets ----------
const at = (d, hm) => `${d}T${hm}:00.000Z`;
const COUNT = { id: 'c1', d: '2026-11-01', at: at('2026-11-01', '12:00'), lines: { DBS: 1000, Cash: 50 }, total: 1050 };
const D = {
  tx: [
    { t: 'exp', d: '2026-11-01', at: at('2026-11-01', '09:00'), amt: 40, acct: 'DBS' }, // before the count
    { t: 'exp', d: '2026-11-01', at: at('2026-11-01', '15:00'), amt: 10, acct: 'DBS' }, // same day, after it
    { t: 'inc', d: '2026-11-05', amt: 200, acct: 'DBS' },
    { t: 'xfer', d: '2026-11-06', amt: 30, from: 'DBS', to: 'Cash' },
    { t: 'exp', d: '2026-11-07', amt: 12.5, acct: 'Cash' },
    { t: 'exp', pm: 'later', d: '2026-11-08', amt: 99 }, // PayLater moves no wallet
    { t: 'exp', d: '2026-11-08', amt: 77, acct: 'DBS', propOf: 'x' }, // a prop firm mirror carries no cash
    { t: 'exp', d: '2026-11-20', amt: 500, acct: 'DBS' } // dated in the future
  ],
  ledger: [
    { d: '2026-11-09', f: 'in', amt: 100, acct: 'DBS', venue: 'IBKR' },
    { d: '2026-11-09', f: 'bal', amt: 5000, acct: 'DBS', venue: 'IBKR' }
  ],
  debts: [
    { d: '2026-11-10', person: 'Amy', amt: 20, acct: 'Cash' },
    { d: '2026-11-10', person: 'Bo', amt: 15, acct: 'Cash', txId: 't1' } // made by a split bill: no cash of its own
  ],
  bills: [{ from: '2026-10-01', payments: [{ id: 'p1', d: '2026-11-11', amt: 50, from: 'DBS' }] }]
};
const TODAY = '2026-11-15';

test('flowsSince: the change to all your money since a count', () => {
  // -10 + 200 - 12.5 - 99 (PayLater: the full amount) - 100 - 20; transfers, bill payments and the future don't count
  assert.equal(M.r2(M.flowsSince(COUNT, D, TODAY)), -41.5);
});

test('walletMoves: each wallet since the count, and the future has not happened yet', () => {
  const mv = M.walletMoves(D, ['DBS', 'Cash'], COUNT, null, TODAY);
  const by = (n) => M.r2(M.sum(mv.filter((m) => m.acct === n), (m) => m.amt));
  assert.equal(by('DBS'), 10); // -10 + 200 - 30 - 100 - 50
  assert.equal(by('Cash'), -2.5); // +30 - 12.5 - 20
  assert.ok(!mv.some((m) => m.d > TODAY), 'an entry dated after today moved a wallet');
  // the total still agrees: count + change = wallets - what PayLater added to what you owe
  assert.equal(M.r2(COUNT.total + M.flowsSince(COUNT, D, TODAY)), M.r2(1000 + by('DBS') + 50 + by('Cash') - (99 - 50)));
  // up to a later count instead of today: with no times saved, that day's transfer counts as before it
  const c2 = { id: 'c2', d: '2026-11-06', lines: {} };
  assert.equal(M.r2(M.sum(M.walletMoves(D, ['DBS', 'Cash'], COUNT, c2).filter((m) => m.acct === 'DBS'), (m) => m.amt)), 160);
});

test('walletModel: balance now, on a past day, before the count, and with no count at all', () => {
  const W = M.walletModel(M.walletFlows(D, 'DBS'), [COUNT], 'DBS', TODAY);
  assert.equal(W.anchor, 1000);
  assert.equal(W.now, 1010);
  assert.equal(W.balOn('2026-11-05'), 1190);
  assert.equal(W.balOn('2026-10-31'), 1040); // before the count: the 40 spent that morning hadn't gone yet
  assert.equal(W.balOn('2026-11-20'), 510);
  const none = M.walletModel(M.walletFlows(D, 'DBS'), [], 'DBS', TODAY);
  assert.equal(none.anchorC, null);
  assert.equal(none.now, -40 - 10 + 200 - 30 - 100 - 50);
});

test('walletFlows: one wallet, newest first, payments made in one go shown once', () => {
  const D2 = { ...D, bills: [
    { from: '2026-09-01', payments: [{ id: 'p2', payId: 'L1', d: '2026-11-12', amt: 30, from: 'DBS' }] },
    { from: '2026-10-01', prov: 'Atome', payments: [{ id: 'p3', payId: 'L1', d: '2026-11-12', amt: 25.25, from: 'DBS' }] }
  ] };
  const f = M.walletFlows(D2, 'DBS');
  const lump = f.filter((x) => x.src === 'bill');
  assert.equal(lump.length, 1);
  assert.equal(lump[0].amt, -55.25);
  assert.equal(lump[0].prov, 'GrabPay Later');
  for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].d >= f[i].d);
  deq(M.walletFlows(D, 'Cash').map((x) => x.src).sort(), ['debt', 'tx', 'xfer-in']);
});

test('wallet names that are JavaScript built-ins are just names', () => {
  // a count with no line for "constructor" used to anchor the wallet to Object's constructor: NaN
  const W = M.walletModel([{ d: '2026-11-05', amt: 5 }], [{ d: '2026-11-01', lines: { DBS: 1 } }], 'constructor', TODAY);
  assert.equal(W.anchorC, null);
  assert.equal(W.now, 5);
  const W2 = M.walletModel([], [{ d: '2026-11-01', lines: JSON.parse('{"__proto__": 7}') }], '__proto__', TODAY);
  assert.equal(W2.anchor, 7);
  // money naming a wallet you don't have isn't credited to a built-in
  const mv = M.walletMoves({ tx: [{ t: 'exp', d: '2026-11-05', amt: 5, acct: 'toString' }, { t: 'exp', d: '2026-11-05', amt: 1, acct: '__proto__' }] }, ['DBS'], COUNT, null, TODAY);
  deq(mv.map((m) => m.acct), [null, null]);
  assert.equal(Object.prototype.amt, undefined);
});

// ---------- seeded random ledgers ----------
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SEED = +(process.env.FUZZ_SEED || 20261115), RUNS = +(process.env.FUZZ_RUNS || 400);
const NAMES = ['DBS', 'Cash', 'Wise', 'constructor', '__proto__'];

function genLedger(R) {
  const pick = (a) => a[Math.floor(R() * a.length)];
  const day = () => `2026-${String(10 + Math.floor(R() * 3)).padStart(2, '0')}-${String(1 + Math.floor(R() * 28)).padStart(2, '0')}`;
  const amt = () => Math.round(R() * 50000) / 100 + 0.01;
  const hm = () => `${String(Math.floor(R() * 24)).padStart(2, '0')}:${String(Math.floor(R() * 60)).padStart(2, '0')}`;
  const tx = [], ledger = [], debts = [], bills = [];
  const n = 5 + Math.floor(R() * 40);
  for (let i = 0; i < n; i++) {
    const d = day(), r = R(), base = { id: 'x' + i, d, at: at(d, hm()), amt: amt() };
    if (r < 0.4) tx.push({ ...base, t: pick(['exp', 'inc']), acct: pick(NAMES) });
    else if (r < 0.55) tx.push({ ...base, t: 'xfer', from: pick(NAMES), to: pick(NAMES) });
    else if (r < 0.75) tx.push({ ...base, t: 'exp', pm: 'later', plp: R() < 0.8 ? undefined : 'Atome', ...(R() < 0.4 ? { inst: { n: pick([1, 4, 8, 12, 2.5, '4', 0]), fee: pick([0, 1.5, '2', 'x']), start: R() < 0.3 ? 1 : 0 } } : {}) });
    else if (r < 0.85) ledger.push({ ...base, f: pick(['in', 'out', 'bal']), acct: pick(NAMES), venue: 'V' });
    else debts.push({ ...base, person: 'P', amt: (R() < 0.5 ? -1 : 1) * amt(), acct: pick(NAMES), ...(R() < 0.2 ? { txId: 't' } : {}) });
  }
  for (let k = 0; k < 3; k++) {
    if (R() < 0.5) continue;
    const from = `2026-${String(10 + k).padStart(2, '0')}-01`;
    bills.push({ from, n: pick([1, 4, 8, 12]), fee: pick([0, 3, '1']), payments: Array.from({ length: Math.floor(R() * 4) }, (_, j) => { const d = day(); return { id: `b${k}${j}`, d, at: at(d, hm()), amt: amt(), from: pick(NAMES) }; }) });
  }
  return { tx, ledger, debts, bills };
}

test(`random ledgers (seed ${SEED}, ${RUNS} runs): bills add up and wallets agree with each other`, () => {
  const R = mulberry32(SEED);
  for (let run = 0; run < RUNS; run++) {
    const L = genLedger(R), cs = 1 + Math.floor(R() * 28), why = `seed ${SEED} run ${run}`;
    for (const prov of ['GrabPay Later', 'Atome']) {
      // with no bills, you owe every purchase in full, an instalment plan's fee included, to the cent
      const mine = L.tx.filter((t) => t.pm === 'later' && M.provOf(t) === prov);
      const owed = mine.reduce((a, t) => { const sh = M.instShares(t, cs); return a + (sh.length > 1 ? cents(M.sum(sh, (s) => s.amt)) : cents(t.amt)); }, 0);
      assert.equal(cents(M.laterOwed(L.tx, [], prov, cs)), owed, why);
      for (const t of mine) {
        const sh = M.instShares(t, cs);
        assert.ok(sh.length >= 1 && sh.length <= 60, why);
        assert.ok(sh.every((s) => s.from.slice(8) === String(cs).padStart(2, '0')), why);
      }
    }
    for (const b of L.bills) {
      const sched = M.billSchedule(L.tx, b, cs), due = M.billDue(L.tx, b, cs), paid = M.billPaid(b);
      assert.equal(cents(M.sum(sched, (s) => s.amt)), cents(due), why);
      assert.ok(Math.abs(cents(M.sum(sched, (s) => s.part)) - cents(Math.max(0, Math.min(paid, due)))) <= 1, why);
      assert.equal(cents(M.billLeft(L.tx, b, cs)), cents(due) - cents(paid), why);
      assert.ok(Number.isFinite(due) && Number.isFinite(paid), why);
    }
    // the wallet page and the balance check use two copies of the same rules: they must agree
    const count = { id: 'cnt', d: '2026-11-01', at: at('2026-11-01', '12:00'), lines: { DBS: 100, Cash: 20 } };
    const wallets = NAMES.slice(0, 3);
    const mv = M.walletMoves(L, wallets, count, null, TODAY);
    for (const n of wallets) {
      const fromMoves = M.r2((count.lines[n] || 0) + M.sum(mv.filter((m) => m.acct === n), (m) => m.amt));
      const W = M.walletModel(M.walletFlows(L, n), [count], n, TODAY);
      assert.equal(W.now, count.lines[n] != null ? fromMoves : M.r2(M.sum(M.walletFlows(L, n).filter((f) => f.d <= TODAY), (f) => f.amt)), `${why} wallet ${n}`);
    }
    assert.ok(mv.every((m) => m.acct === null || wallets.includes(m.acct)), why);
    assert.ok(Number.isFinite(M.flowsSince(count, L, TODAY)), why);
  }
  assert.equal(Object.prototype.amt, undefined);
  assert.equal(Object.prototype[1], undefined);
});
