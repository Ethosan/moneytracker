// The money maths from js/money.js, the sums behind the app's own screens. Run with `npm test`.
// Every expected figure here is worked out by hand from the rows above it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// money.js is a plain browser script that defines the global Money; run it in a sandbox and read it back.
const C = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'money.js'), 'utf8'), C);
const M = C.Money;
// objects made inside the sandbox have its prototypes, which deepEqual treats as different: compare plain copies
const J = (x) => JSON.parse(JSON.stringify(x));

const CATS = [
  { name: '🍜 Food', type: 'exp' },
  { name: '💼 Salary', type: 'inc', kind: 'earned' },
  { name: '↩️ Paybacks', type: 'inc', kind: 'reimb' },
  { name: '🏅 Bonus', type: 'inc', kind: 'other' },
  { name: '🎁 Gift', type: 'inc' } // no kind: counts as other income
];

test('r2 rounds to cents', () => {
  assert.equal(M.r2(0.1 + 0.2), 0.3);
  assert.equal(M.r2(19.999), 20);
  assert.equal(M.r2(1.005), 1); // 1.005 is stored as 1.00499...: the same as the screens have always shown
  assert.equal(M.r2(-0.125), -0.12); // an exact half rounds up, towards +infinity
});

test('ea counts only your share of a split bill', () => {
  assert.equal(M.ea({ t: 'exp', amt: 90, split: { mine: 30, person: 'Sam' } }), 30);
  assert.equal(M.ea({ t: 'exp', amt: 90, split: { mine: 0, person: 'Sam' } }), 0); // paid entirely for someone else
  assert.equal(M.ea({ t: 'exp', amt: 90, split: { mine: -1, person: 'Sam' } }), 90); // no share set: the whole amount
  assert.equal(M.ea({ t: 'exp', amt: 90 }), 90);
  assert.equal(M.ea({ t: 'inc', amt: 50, split: { mine: 10 } }), 50); // splits only apply to spending
});

test('catKind reads the category kind, other when unknown', () => {
  assert.equal(M.catKind(CATS, '💼 Salary'), 'earned');
  assert.equal(M.catKind(CATS, '↩️ Paybacks'), 'reimb');
  assert.equal(M.catKind(CATS, '🎁 Gift'), 'other');
  assert.equal(M.catKind(CATS, 'Nope'), 'other');
  assert.equal(M.catKind(undefined, '💼 Salary'), 'other');
});

test('monthStats: spent, paybacks, net and saved', () => {
  const rows = [
    { t: 'exp', amt: 12.5, cat: '🍜 Food', tags: ['Dates'] },
    { t: 'exp', amt: 90, cat: '🍜 Food', split: { mine: 30, person: 'Sam' } },
    { t: 'inc', amt: 2000, cat: '💼 Salary' },
    { t: 'inc', amt: 60, cat: '↩️ Paybacks' },
    { t: 'inc', amt: 100, cat: '🎁 Gift' },
    { t: 'xfer', amt: 500, from: 'Bank', to: 'Cash' }, // moving your own money is neither
    { t: 'adj', amt: 7 }
  ];
  const s = M.monthStats(rows, CATS, 'Dates');
  assert.equal(s.spend, 42.5);
  assert.equal(s.byCat['🍜 Food'], 42.5);
  assert.equal(s.person, 12.5);
  assert.equal(s.byTag.Dates, 12.5);
  assert.equal(s.earned, 2000);
  assert.equal(s.reimb, 60);
  assert.equal(s.other, 100);
  assert.equal(s.net, -17.5); // 42.5 spent, 60 paid back
  assert.equal(s.saved, 2117.5); // 2000 + 100 - (-17.5)
});

test('monthStats on an empty month is all zeros', () => {
  const s = M.monthStats([], CATS, null);
  assert.deepEqual([s.spend, s.earned, s.other, s.reimb, s.net, s.saved], [0, 0, 0, 0, 0, 0]);
  assert.equal(M.monthStats(undefined, CATS, null).spend, 0);
});

test('incomeBy leaves paybacks out and rounds', () => {
  const r = M.incomeBy([
    { t: 'inc', amt: 0.1, cat: '💼 Salary' }, { t: 'inc', amt: 0.2, cat: '💼 Salary' },
    { t: 'inc', amt: 60, cat: '↩️ Paybacks' }, { t: 'inc', amt: 5, cat: '🏅 Bonus' }, { t: 'exp', amt: 9, cat: '🍜 Food' }
  ], CATS);
  assert.deepEqual(J(r.by), { '💼 Salary': 0.3, '🏅 Bonus': 5 });
  assert.equal(r.work, 0.3);
  assert.equal(r.other, 5);
  assert.equal(r.total, 5.3);
});

test('tagSpend adds your share of tagged spending', () => {
  assert.equal(M.tagSpend([
    { t: 'exp', amt: 40, tags: ['Trip'], split: { mine: 10, person: 'Sam' } },
    { t: 'exp', amt: 5, tags: ['Trip'] }, { t: 'exp', amt: 99 }, { t: 'inc', amt: 70, tags: ['Trip'] }
  ], 'Trip'), 15);
});

test('venuePnl, cash basis: result is taken out minus paid in, opening balance counts as paid in', () => {
  const meta = { venues: { Moomoo: { type: 'broker' } } };
  const led = [
    { venue: 'Moomoo', d: '2026-01-01', f: 'bal', amt: 1000 },
    { venue: 'Moomoo', d: '2026-02-01', f: 'in', amt: 500 },
    { venue: 'Moomoo', d: '2026-03-01', f: 'out', amt: 300 },
    { venue: 'Moomoo', d: '2026-03-01', f: 'bal', amt: 1400 }
  ];
  const p = M.venuePnl(led, 'Moomoo', meta);
  assert.equal(p.cash, true);
  assert.equal(p.opening, 1000);
  assert.equal(p.inn, 1500);
  assert.equal(p.out, 300);
  assert.equal(p.pnl, -1200);
  assert.equal(p.paper, 1400);
  assert.equal(p.open, true); // money still with the broker: not a result yet
  assert.equal(p.outThere, 1200);
  // closed, the same money is a result
  assert.equal(M.venuePnl(led, 'Moomoo', { venues: { Moomoo: { type: 'broker', closed: true } } }).open, false);
});

test('venuePnl, balance basis: last balance minus opening plus withdrawals minus deposits', () => {
  const meta = { basis: 'balance', venues: { IBKR: { type: 'broker' } } };
  const led = [
    { venue: 'IBKR', d: '2026-01-01', f: 'bal', amt: 1000 },
    { venue: 'IBKR', d: '2026-02-01', f: 'in', amt: 500 },
    { venue: 'IBKR', d: '2026-03-01', f: 'out', amt: 200 },
    { venue: 'IBKR', d: '2026-04-01', f: 'bal', amt: 1450 },
    { venue: 'IBKR', d: '2026-05-01', f: 'in', amt: 50 } // after the last balance
  ];
  const p = M.venuePnl(led, 'IBKR', meta);
  assert.equal(p.cash, undefined);
  assert.equal(p.bal, 1450);
  assert.equal(p.pnl, 150); // 1450 - 1000 + 200 - 500
  assert.equal(p.stale, true);
  assert.equal(p.inn, 550);
  assert.equal(p.out, 200);
});

test('venuePnl: prop firms stay on a cash basis; partners are kept apart', () => {
  const meta = { basis: 'balance', venues: { Apex: { type: 'prop' } } };
  const p = M.venuePnl([
    { venue: 'Apex', d: '2026-01-01', f: 'in', amt: 150 },
    { venue: 'Apex', d: '2026-01-05', f: 'in', amt: 150, who: 'Jo' },
    { venue: 'Apex', d: '2026-02-01', f: 'out', amt: 1000 },
    { venue: 'Apex', d: '2026-02-03', f: 'out', amt: 400, who: 'Jo' }
  ], 'Apex', meta);
  assert.equal(p.cash, true);
  assert.equal(p.pnl, 850);
  assert.deepEqual(J(p.partners), { Jo: -250 });
  assert.equal(p.n, 4);
});

test('venuePnl, balance basis: closed with no later balance ends at zero', () => {
  const p = M.venuePnl([
    { venue: 'X', d: '2026-01-01', f: 'bal', amt: 100 },
    { venue: 'X', d: '2026-02-01', f: 'in', amt: 50 },
    { venue: 'X', d: '2026-03-01', f: 'out', amt: 180 }
  ], 'X', { basis: 'balance', venues: { X: { type: 'broker', closed: true } } });
  assert.equal(p.bal, 0);
  assert.equal(p.pnl, 30); // 180 - 50 - 100
  assert.equal(p.stale, false);
});

test('personBalances: positive means they owe you', () => {
  assert.deepEqual(J(M.personBalances([
    { person: 'Sam', amt: 60 }, { person: 'Sam', amt: -20 }, { person: 'Jo', amt: -15 }, { person: 'Ann', amt: 10 }, { person: 'Ann', amt: -10 }
  ])), { Sam: 40, Jo: -15, Ann: 0 });
});

test('monthlyEquiv spreads a subscription over its cycle', () => {
  assert.equal(M.monthlyEquiv({ amt: 120, cycle: 12 }), 10);
  assert.equal(M.monthlyEquiv({ amt: 9.98 }), 9.98);
});
