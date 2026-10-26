// ---- dates ----
// Plain functions on 'YYYY-MM-DD' and 'YYYY-MM' strings, with no app state, so tests/ can load
// this file on its own. Month-end rules live here: they have broken often enough to deserve tests.
var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function pad2(n) { return String(n).padStart(2, '0'); }
function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function monthOf(d) { return d.slice(0, 7); }
function addMonth(m, k) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y + '-' + String(mo + 1).padStart(2, '0'); }
function addDays(d, n) { var x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
function lastDayOf(m) { return new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate(); }
// Day `day` of month m, or the month's last day when it is shorter: the 31st in February is the 28th or 29th.
function dayInMonth(m, day) { return m + '-' + pad2(Math.min(day, lastDayOf(m))); }
// The i-th monthly due date counted from `first` (i = 0 is `first` itself), keeping first's day where the month has it.
function instalmentDate(first, i) { return dayInMonth(addMonth(monthOf(first), i), +first.slice(8, 10)); }
// When a subscription paid on d renews. `day` is the day of the month it was set up on, so one that
// renews on the 31st comes back to the 31st after passing through a shorter month.
function renewalAfter(d, cycle, day) { return dayInMonth(addMonth(monthOf(d), cycle || 1), day || +d.slice(8, 10)); }
function isRealDate(d) { var mo = +d.slice(5, 7), dd = +d.slice(8, 10); return mo >= 1 && mo <= 12 && dd >= 1 && dd <= lastDayOf(d.slice(0, 7)); }
// A date that doesn't exist (31 Feb, month 13) moved to the nearest real day of its month.
function clampDate(d) { var m = d.slice(0, 5) + pad2(Math.min(12, Math.max(1, +d.slice(5, 7)))); return dayInMonth(m, Math.max(1, +d.slice(8, 10))); }
function ymd(y, m, d) { if (y < 100) y += 2000; if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) return null; return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
// Statement dates in any of the formats banks use, read day-first. Impossible dates give null, unless
// `lenient`, which moves the 29th-31st to the month's last day and notes it in parseDateAny.fixed.
function parseDateAny(v, lenient) {
  function mk(y, m, d) {
    var r = ymd(y, m, d);
    if (!r && lenient && m >= 1 && m <= 12 && d >= 29 && d <= 31) { var yy = y < 100 ? y + 2000 : y; r = ymd(yy, m, new Date(yy, m, 0).getDate()); parseDateAny.fixed = d + ' ' + MN[m - 1] + ' ' + yy; }
    return r;
  }
  if (v == null || v === '') return null;
  if (typeof v === 'number') { if (v > 20000 && v < 80000 && typeof XLSX !== 'undefined') { var c = XLSX.SSF.parse_date_code(v); return ymd(c.y, c.m, c.d); } return null; }
  if (v instanceof Date) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  var s = String(v), m;
  if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
  if ((m = s.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/))) return mk(+m[3], +m[2], +m[1]);
  if ((m = s.match(/\b(\d{1,2})[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s,-]+(\d{4})\b/i))) return mk(+m[3], MON[m[2].toLowerCase()], +m[1]);
  if ((m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i))) return mk(+m[3], MON[m[1].toLowerCase()], +m[2]);
  if ((m = s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/i))) {
    var y = new Date().getFullYear(), d = mk(y, MON[m[2].toLowerCase()], +m[1]); if (d > today()) { parseDateAny.fixed = null; d = mk(y - 1, MON[m[2].toLowerCase()], +m[1]); } return d;
  }
  return null;
}

// ---- when something was logged, and which side of a balance count it falls on ----
// Ids from uid() are 'a' + Date.now() in base 36 (8 characters from 1972 to 2059) + a random tail,
// so every entry and every count already carries the moment it was saved.
function idTime(id) {
  if (typeof id !== 'string' || !/^a[0-9a-z]{9,13}$/.test(id)) return null;
  var ms = parseInt(id.slice(1, 9), 36);
  return ms > 1.3e12 && ms < 2.8e12 ? ms : null; // 2011 to 2058: anything else is not one of ours
}
// The moment x was saved, in ms: an explicit `at` (ISO string) wins, else the time in its id.
function whenMade(x) {
  if (!x) return null;
  if (x.at) { var t = Date.parse(x.at); if (!isNaN(t)) return t; }
  return idTime(x.id);
}
// Did entry e happen after balance count c? On different days the dates decide. On the count's own
// day, the count is a snapshot of the moment it was saved, not the end of the day: an entry logged
// after that moment is after the count and is not inside the counted figure. With no time on either
// side the day's entries count as before (the old end-of-day rule).
function afterCount(c, e) {
  if (!c || !e || !e.d || !c.d) return false;
  if (e.d > c.d) return true;
  if (e.d < c.d) return false;
  var tc = whenMade(c), te = whenMade(e);
  return tc != null && te != null && te > tc;
}
// An `at` stamp that puts an entry one second before (side -1) or after (side +1) count c.
function besideCount(c, side) { var t = whenMade(c); return t == null ? null : new Date(t + (side < 0 ? -1000 : 1000)).toISOString(); }
