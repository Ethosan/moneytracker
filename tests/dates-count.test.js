// A balance count is a moment, not a day (js/dates.js: idTime, whenMade, afterCount, besideCount).
// The bug these pin: 2,500 counted in the afternoon, a 1,200 hotel paid that evening, and the next day the
// wallet still read 2,500 because every same-day entry was taken as before the count. The id of every
// entry and count carries the moment it was saved, so the same-day order is known without new data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const D = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'dates.js'), 'utf8'), D);

const idAt = (iso) => 'a' + Date.parse(iso).toString(36) + 'k3x9q';
const DAY = '2026-10-24', T = (hm) => DAY + 'T' + hm + ':00+08:00';
const count = { id: idAt(T('14:30')), d: DAY, total: 2500, lines: { DBS: 2500 } };

test('idTime reads the moment out of an app id and rejects other ids', () => {
  assert.equal(D.idTime(idAt(T('14:30'))), Date.parse(T('14:30')));
  assert.equal(D.idTime('a' + Date.parse(T('14:30')).toString(36) + 'z'), Date.parse(T('14:30')), 'a short random tail still parses');
  assert.equal(D.idTime('b9'), null);
  assert.equal(D.idTime('a1'), null);
  assert.equal(D.idTime('aaaaaaaaaaaaaaaaaaaaaaaaaa'), null, 'too long');
  assert.equal(D.idTime('a000000001abcd'), null, 'a moment in 1970 is not one of ours');
  assert.equal(D.idTime(null), null);
});

test('whenMade: an explicit at wins over the id', () => {
  assert.equal(D.whenMade({ id: idAt(T('14:30')) }), Date.parse(T('14:30')));
  assert.equal(D.whenMade({ id: idAt(T('14:30')), at: T('09:00') }), Date.parse(T('09:00')));
  assert.equal(D.whenMade({ id: idAt(T('14:30')), at: 'garbage' }), Date.parse(T('14:30')), 'an unreadable at falls back to the id');
  assert.equal(D.whenMade({ id: 'b9' }), null);
});

test('afterCount: the hotel paid after the afternoon count is after it; lunch before it was inside it', () => {
  assert.equal(D.afterCount(count, { d: DAY, id: idAt(T('12:10')) }), false);
  assert.equal(D.afterCount(count, { d: DAY, id: idAt(T('19:05')) }), true);
  assert.equal(D.afterCount(count, { d: DAY, id: idAt('2026-10-25T09:00:00+08:00') }), true, 'logged the next morning, dated the count day');
  assert.equal(D.afterCount(count, { d: '2026-10-25', id: 'b1' }), true, 'later day: date decides');
  assert.equal(D.afterCount(count, { d: '2026-10-23', id: idAt(T('23:59')) }), false, 'earlier day: date decides');
  assert.equal(D.afterCount(count, { d: DAY, id: 'b9' }), false, 'no time on the entry: before, the old rule');
  assert.equal(D.afterCount({ id: 'c1', d: DAY }, { d: DAY, id: idAt(T('19:05')) }), false, 'no time on the count: before, the old rule');
  assert.equal(D.afterCount(null, { d: DAY, id: 'b9' }), false);
});

test('besideCount gives an at one second either side of the count, and afterCount honours it', () => {
  const before = D.besideCount(count, -1), after = D.besideCount(count, 1);
  assert.equal(Date.parse(before), Date.parse(T('14:30')) - 1000);
  assert.equal(Date.parse(after), Date.parse(T('14:30')) + 1000);
  assert.equal(D.afterCount(count, { d: DAY, id: idAt(T('19:05')), at: before }), false, 'flipped to before');
  assert.equal(D.afterCount(count, { d: DAY, id: idAt(T('12:10')), at: after }), true, 'flipped to after');
  assert.equal(D.besideCount({ id: 'c1', d: DAY }, 1), null, 'a count with no time cannot be a reference');
});

test('the balance after the count: counted minus what was paid after it, never minus what was inside it', () => {
  const flows = [
    { d: DAY, id: idAt(T('12:10')), amt: -20 },
    { d: DAY, id: idAt(T('19:05')), amt: -1200 },
    { d: '2026-10-25', id: idAt('2026-10-25T09:30:00+08:00'), amt: -15 },
  ];
  const since = flows.filter((f) => D.afterCount(count, f)).reduce((n, f) => n + f.amt, 0);
  assert.equal(2500 + since, 1285);
});
