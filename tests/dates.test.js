// Month-end and date-parsing rules from js/dates.js. Run with `npm test` (Node 18+, no installs).
// Most cases here are bugs that once shipped: instalments on the 31st, renewals that drifted to
// the 28th, and impossible dates like 31 Feb coming in from statements.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// dates.js is a plain browser script that defines globals; run it in a sandbox and read them back.
const D = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'dates.js'), 'utf8'), D);

test('lastDayOf knows month lengths and leap years', () => {
  assert.equal(D.lastDayOf('2026-01'), 31);
  assert.equal(D.lastDayOf('2026-02'), 28);
  assert.equal(D.lastDayOf('2028-02'), 29);
  assert.equal(D.lastDayOf('2100-02'), 28); // divisible by 100, not 400
  assert.equal(D.lastDayOf('2000-02'), 29); // divisible by 400
  assert.equal(D.lastDayOf('2026-04'), 30);
});

test('addMonth crosses year boundaries both ways', () => {
  assert.equal(D.addMonth('2026-12', 1), '2027-01');
  assert.equal(D.addMonth('2026-01', -1), '2025-12');
  assert.equal(D.addMonth('2026-01', 25), '2028-02');
  assert.equal(D.addMonth('2026-03', -15), '2024-12');
  assert.equal(D.addMonth('2026-05', 0), '2026-05');
});

test('addDays crosses months, years and leap days', () => {
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(D.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(D.addDays('2026-10-15', 30), '2026-11-14');
});

test('dayInMonth falls back to the last day of shorter months', () => {
  assert.equal(D.dayInMonth('2026-02', 31), '2026-02-28');
  assert.equal(D.dayInMonth('2028-02', 30), '2028-02-29');
  assert.equal(D.dayInMonth('2026-04', 31), '2026-04-30');
  assert.equal(D.dayInMonth('2026-05', 31), '2026-05-31');
  assert.equal(D.dayInMonth('2026-05', 5), '2026-05-05');
});

test('PayLater instalments due on the 31st land on each month\'s last day', () => {
  const dates = [0, 1, 2, 3, 4].map((i) => D.instalmentDate('2026-01-31', i));
  assert.deepEqual(dates, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('instalments on an ordinary day keep that day', () => {
  const dates = [0, 1, 2].map((i) => D.instalmentDate('2026-11-15', i));
  assert.deepEqual(dates, ['2026-11-15', '2026-12-15', '2027-01-15']);
});

test('a subscription on the 31st renews on the 31st again after February', () => {
  const feb = D.renewalAfter('2026-01-31', 1, 31);
  assert.equal(feb, '2026-02-28');
  assert.equal(D.renewalAfter(feb, 1, 31), '2026-03-31'); // not stuck on the 28th
});

test('subscription renewal handles other cycles', () => {
  assert.equal(D.renewalAfter('2026-11-30', 3, 30), '2027-02-28'); // quarterly into February
  assert.equal(D.renewalAfter('2028-02-29', 12, 29), '2029-02-28'); // yearly from a leap day
  assert.equal(D.renewalAfter('2026-10-15'), '2026-11-15'); // cycle and day default to monthly, same day
});

test('isRealDate rejects dates that do not exist', () => {
  assert.equal(D.isRealDate('2026-10-15'), true);
  assert.equal(D.isRealDate('2028-02-29'), true);
  assert.equal(D.isRealDate('2026-02-29'), false);
  assert.equal(D.isRealDate('2026-04-31'), false);
  assert.equal(D.isRealDate('2026-13-01'), false);
  assert.equal(D.isRealDate('2026-00-10'), false);
  assert.equal(D.isRealDate('2026-04-00'), false);
});

test('clampDate moves impossible dates to the nearest real day', () => {
  assert.equal(D.clampDate('2026-02-31'), '2026-02-28');
  assert.equal(D.clampDate('2026-13-05'), '2026-12-05');
  assert.equal(D.clampDate('2026-00-05'), '2026-01-05');
  assert.equal(D.clampDate('2026-04-00'), '2026-04-01');
  assert.equal(D.clampDate('2026-10-15'), '2026-10-15');
});

test('ymd builds dates and rejects impossible ones', () => {
  assert.equal(D.ymd(2026, 10, 5), '2026-10-05');
  assert.equal(D.ymd(26, 10, 5), '2026-10-05');
  assert.equal(D.ymd(2026, 2, 29), null);
  assert.equal(D.ymd(2028, 2, 29), '2028-02-29');
  assert.equal(D.ymd(2026, 13, 1), null);
  assert.equal(D.ymd(2026, 6, 0), null);
});

test('parseDateAny reads the formats statements use, day first', () => {
  assert.equal(D.parseDateAny('2026-10-15'), '2026-10-15');
  assert.equal(D.parseDateAny('15/10/2026'), '2026-10-15');
  assert.equal(D.parseDateAny('05/03/2026'), '2026-03-05'); // 5 March, not 3 May
  assert.equal(D.parseDateAny('05.03.26'), '2026-03-05');
  assert.equal(D.parseDateAny('3 Oct 2026'), '2026-10-03');
  assert.equal(D.parseDateAny('3-Sept-2026'), '2026-09-03');
  assert.equal(D.parseDateAny('Oct 3, 2026'), '2026-10-03');
  assert.equal(D.parseDateAny('Paid on 12 January 2026 at 10:41'), '2026-01-12');
  assert.equal(D.parseDateAny(new Date(2026, 9, 15)), '2026-10-15');
});

test('parseDateAny returns null for empty or unreadable input', () => {
  assert.equal(D.parseDateAny(''), null);
  assert.equal(D.parseDateAny(null), null);
  assert.equal(D.parseDateAny(undefined), null);
  assert.equal(D.parseDateAny('no date here'), null);
  assert.equal(D.parseDateAny(45000), null); // a spreadsheet serial, but no spreadsheet reader loaded
});

test('parseDateAny rejects 31 Feb, or moves it to month end when lenient', () => {
  assert.equal(D.parseDateAny('31 Feb 2026'), null);
  assert.equal(D.parseDateAny('31/04/2026'), null);
  D.parseDateAny.fixed = null;
  assert.equal(D.parseDateAny('31 Feb 2026', true), '2026-02-28');
  assert.equal(D.parseDateAny.fixed, '31 Feb 2026');
  assert.equal(D.parseDateAny('30/02/2028', true), '2028-02-29');
  assert.equal(D.parseDateAny('32/01/2026', true), null); // lenient only covers the 29th to 31st
});

test('a date without a year is never in the future', () => {
  for (const s of ['1 Jan', '31 Dec', '15 Jun']) {
    const d = D.parseDateAny(s);
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d <= D.today(), s + ' gave ' + d);
  }
});
