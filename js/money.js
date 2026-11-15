// ---- money maths ----
// The sums behind the app's screens, as plain functions with no app state: each one takes the rows
// it adds up, so tests/ can load this file on its own. app.js calls these through thin wrappers that
// pass in its state (S.tx, S.meta, S.ledger, S.debts).
//
// The Ask chat's engine (supabase/functions/ledger-ai/engine.ts) has its own copy of these rules,
// because the Edge Function cannot load a browser script. tests/money-parity.test.mjs runs the same
// ledger through both and fails if they disagree: change a rule here, change it there too.
var Money = (function () {
  'use strict';
  function r2(n) { return Math.round(n * 100) / 100; }
  function sum(a, f) { var s = 0; for (var i = 0; i < a.length; i++) s += f ? f(a[i]) : a[i]; return s; }
  // A stored amount, rounded to cents: text is read; anything unreadable, infinite or beyond S$100 billion
  // (a typo or a pasted card number, never real money, and past it sums stop being exact to the cent) is 0.
  var MAX_AMOUNT = 1e11;
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) && Math.abs(n) <= MAX_AMOUNT ? r2(n) : 0; }

  // ---- cleaning stored rows before they are added up ----
  // Saved data can be old, imported or edited by hand, so every sum reads rows through these first
  // (app.js normalize() on load; engine.ts loadLedger mirrors them). They change the row in place,
  // the way normalize always has, and say whether it can count at all.
  // A transaction: a real YYYY-MM-DD date, a positive amount in cents (a sign is dropped: the type
  // says which way money went), tags a list, and a split share no larger than the bill.
  function cleanTx(t) {
    if (!t || typeof t !== 'object' || typeof t.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.d)) return false;
    t.amt = Math.abs(num(t.amt)); if (!t.amt) return false;
    t.tags = Array.isArray(t.tags) ? t.tags.filter(function (g) { return typeof g === 'string'; }) : [];
    if (t.split && typeof t.split === 'object') { t.split.mine = Math.min(num(t.split.mine), t.amt); if (!t.split.person) delete t.split; }
    else delete t.split;
    return true;
  }
  // People entries: dated, the amount a number (signed: positive means they owe you).
  function cleanDebts(list) {
    return (Array.isArray(list) ? list : []).filter(function (e) { return e && typeof e === 'object' && e.d; })
      .map(function (e) { e.amt = num(e.amt); return e; });
  }
  // Investment entries: the same, and money in or out must be more than zero (a balance may be 0).
  function cleanLedger(list) { return cleanDebts(list).filter(function (e) { return e.f === 'bal' || e.amt > 0; }); }

  // Totals keyed by names the owner typed (categories, tags, people) live in objects with no
  // prototype, so a category called "constructor" or "__proto__" is just a name and adds up like any other.
  function bag() { return Object.create(null); }
  function own(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }

  // What a transaction actually cost you: if you paid for others, only your share counts as
  // spending. The rest is money owed to you, tracked under People.
  function ea(t) { return t.t === 'exp' && t.split && t.split.mine >= 0 ? t.split.mine : t.amt; }

  // An income category's kind: 'earned' (work), 'reimb' (friends paying you back) or 'other'.
  function catKind(cats, name) {
    if (!Array.isArray(cats)) return 'other';
    for (var i = 0; i < cats.length; i++) if (cats[i] && cats[i].name === name) return cats[i].kind || 'other';
    return 'other';
  }

  // One month's rows: spent (own share), by category and tag, income by kind, and
  // net = spent - reimbursed, saved = earned + other - net. Not rounded: callers round for display.
  function monthStats(rows, cats, personTag) {
    var o = { spend: 0, earned: 0, other: 0, reimb: 0, person: 0, byCat: bag(), byTag: bag() };
    (rows || []).forEach(function (t) {
      if (t.t === 'exp') {
        var v = ea(t);
        o.spend += v; o.byCat[t.cat] = (o.byCat[t.cat] || 0) + v;
        if (personTag && (t.tags || []).indexOf(personTag) > -1) o.person += v;
        (t.tags || []).forEach(function (g) { o.byTag[g] = (o.byTag[g] || 0) + v; });
      } else if (t.t === 'inc') {
        var k = catKind(cats, t.cat); o[k === 'earned' ? 'earned' : k === 'reimb' ? 'reimb' : 'other'] += t.amt;
      }
    });
    o.net = o.spend - o.reimb; o.saved = o.earned + o.other - o.net;
    return o;
  }

  // Income for one month's rows, without paybacks: by category, work, other and total.
  function incomeBy(rows, cats) {
    var by = bag(), work = 0, other = 0;
    (rows || []).forEach(function (t) {
      if (t.t !== 'inc') return; var k = catKind(cats, t.cat); if (k === 'reimb') return;
      by[t.cat] = r2((by[t.cat] || 0) + t.amt); if (k === 'earned') work += t.amt; else other += t.amt;
    });
    return { by: by, work: r2(work), other: r2(other), total: r2(work + other) };
  }

  // Spending with a tag, own share.
  function tagSpend(rows, tag) { return sum((rows || []).filter(function (t) { return t.t === 'exp' && (t.tags || []).indexOf(tag) > -1; }), ea); }

  // An investment, prop firm, poker or crypto account's result from the venue ledger.
  // Cash basis (prop firms and poker always; brokers and crypto unless meta.basis says otherwise):
  // result = taken out - paid in, and a balance logged before any deposit is capital carried in,
  // so it counts as paid in. Otherwise: last balance - opening balance + taken out - paid in between.
  function venueType(meta, v) { var x = own(meta && meta.venues, v); return (x && x.type) || 'broker'; }
  function isClosed(meta, v) { var x = own(meta && meta.venues, v); return !!(x && x.closed); }
  function cashBasis(meta) { return ((meta && meta.basis) || 'cash') === 'cash'; }
  function venuePnl(ledger, v, meta) {
    var type = venueType(meta, v);
    var all = (ledger || []).filter(function (e) { return e.venue === v; });
    var partners = bag();
    all.forEach(function (e) { if (e.who && e.who !== 'me' && e.f !== 'bal') partners[e.who] = r2((partners[e.who] || 0) + (e.f === 'in' ? e.amt : -e.amt)); });
    var es = all.filter(function (e) { return !e.who || e.who === 'me' || e.f === 'bal'; }).sort(function (a, b) {
      return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.f === 'bal') - (b.f === 'bal');
    });
    var o = { type: type, partners: partners, inn: 0, out: 0, n: all.length, bal: null, pnl: null, stale: false, last: es.length ? es[es.length - 1].d : null, opening: null };
    if (type === 'prop' || type === 'poker' || cashBasis(meta)) {
      var lastBal = null;
      // A balance logged before any deposit or withdrawal is capital carried in from before
      // you started tracking, so on a cash basis it counts as money put in.
      if (es.length && es[0].f === 'bal') { o.opening = es[0].amt; o.inn += es[0].amt; }
      es.forEach(function (e, i) { if (e.f === 'in') o.inn += e.amt; else if (e.f === 'out') o.out += e.amt; else if (i > 0) lastBal = e.amt; });
      o.pnl = r2(o.out - o.inn); o.paper = lastBal; o.cash = true;
      // On a cash basis, money still with a broker is neither profit nor loss yet.
      o.open = (type === 'broker' || type === 'crypto') && !isClosed(meta, v) && o.inn - o.out > 0.01;
      o.outThere = o.open ? r2(o.inn - o.out) : 0;
      return o;
    }
    var startIdx = -1, start = 0;
    if (es.length && es[0].f === 'bal') { startIdx = 0; start = es[0].amt; o.opening = start; }
    var endIdx = -1;
    for (var i = es.length - 1; i > startIdx; i--) if (es[i].f === 'bal') { endIdx = i; break; }
    es.forEach(function (e, i) {
      if (i <= startIdx || e.f === 'bal') return;
      if (e.f === 'in') o.inn += e.amt; else o.out += e.amt;
      if (endIdx > -1 && i > endIdx) o.stale = true;
    });
    if (endIdx < 0 && isClosed(meta, v)) { o.bal = 0; o.pnl = o.out - o.inn - start; o.stale = false; return o; }
    if (endIdx > -1) {
      o.bal = es[endIdx].amt;
      var fin = 0, fout = 0;
      es.forEach(function (e, i) { if (i > startIdx && i < endIdx && e.f !== 'bal') { if (e.f === 'in') fin += e.amt; else fout += e.amt; } });
      o.pnl = o.bal - start + fout - fin;
    }
    return o;
  }

  // Each person's balance from the People entries: positive means they owe you. Not rounded.
  function personBalances(debts) {
    var ppl = bag(); (debts || []).forEach(function (d) { var k = d.person == null ? '' : String(d.person); ppl[k] = (ppl[k] || 0) + d.amt; });
    return ppl;
  }

  // Can a change Ask proposed be applied? The server checks every proposal, but chats are stored and
  // replayed, so Apply checks again before anything touches the ledger: a real date, spending or
  // income, an amount above 0 and below S$10 million (the server's limit), a category that exists and
  // is of the entry's type, and a note of text. cur is the entry an edit changes; cats the categories.
  function realDate(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    var x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
    return x.toISOString().slice(0, 10) === d;
  }
  function changeOk(c, cur, cats) {
    if (!c || typeof c !== 'object') return false;
    if (c.op !== 'add' && c.op !== 'edit' && c.op !== 'delete') return false;
    if (c.op !== 'add' && !cur) return false;
    if (c.op === 'delete') return true;
    if (c.d != null && !realDate(c.d)) return false;
    if (c.t != null && c.t !== 'exp' && c.t !== 'inc') return false;
    if (c.amt != null && !(typeof c.amt === 'number' && c.amt > 0 && c.amt < 1e7)) return false;
    if (c.note != null && typeof c.note !== 'string') return false;
    if (c.op === 'add' && (c.amt == null || c.cat == null)) return false;
    var name = c.cat != null ? c.cat : cur && cur.cat, cat = null;
    for (var i = 0; Array.isArray(cats) && i < cats.length; i++) if (cats[i] && cats[i].name === name) { cat = cats[i]; break; }
    if (c.cat != null && !cat) return false;
    var t = c.t || (cur && cur.t) || (cat && cat.type);
    if (cat && cat.type && t && cat.type !== t) return false; // spending filed under an income category, or the reverse
    return true;
  }

  // A subscription's cost per month.
  function monthlyEquiv(s) { return s.amt / (s.cycle || 1); }

  return {
    r2: r2, sum: sum, num: num, cleanTx: cleanTx, cleanDebts: cleanDebts, cleanLedger: cleanLedger, ea: ea, catKind: catKind, monthStats: monthStats, incomeBy: incomeBy, tagSpend: tagSpend,
    venueType: venueType, isClosed: isClosed, cashBasis: cashBasis, venuePnl: venuePnl,
    personBalances: personBalances, monthlyEquiv: monthlyEquiv, changeOk: changeOk
  };
})();
