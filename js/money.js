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

  // ---- PayLater: bills, instalments and what you still owe ----
  // The date helpers (monthOf, addMonth, addDays, pad2, instalmentDate, afterCount) come from js/dates.js,
  // which loads first. txs is every transaction; bills the stored bills; cs the day a provider's statement
  // periods start on (1 to 28). Grab bills a period of PayLater spending as one bill, payable in full the
  // next month or split over 4, 8 or 12 monthly payments.
  var GRAB = 'GrabPay Later';
  function provOf(t) { return t.plp || GRAB; }
  function billProv(b) { return b.prov || GRAB; }
  function cycle(cs) { return Math.min(28, Math.max(1, Math.floor(+cs) || 1)); }
  // A count of instalments: a whole number from 1 to 60 (Grab offers up to 12; anything else is junk,
  // and a fraction or a huge number would split a bill into shares that don't add up, or never finish).
  function parts(n) { n = Math.floor(+n); return n > 1 ? Math.min(n, 60) : 1; }
  // The statement period day d falls in, and its last day.
  function periodStart(d, cs) { cs = cycle(cs); var m = monthOf(d); if (+d.slice(8, 10) < cs) m = addMonth(m, -1); return m + '-' + pad2(cs); }
  function periodEnd(from) { return addDays(addMonth(monthOf(from), 1) + '-' + from.slice(8, 10), -1); }
  // A purchase split into n instalments puts one share into each of n bills in a row (the first one the
  // period after it, if inst.start). You owe the full amount, fee included, from day one; each bill
  // only asks for its share, and the last share takes the rounding so the shares add up to the cent.
  function instShares(t, cs) {
    var n = parts(t.inst && t.inst.n), first = periodStart(t.d, cs), off = t.inst && t.inst.start ? 1 : 0;
    var total = r2(t.amt + num(t.inst && t.inst.fee)), each = r2(total / n), out = [];
    for (var k = 0; k < n; k++) out.push({ from: addMonth(monthOf(first), k + off) + first.slice(7), amt: k === n - 1 ? r2(total - each * (n - 1)) : each, k: k + 1, n: n });
    return out;
  }
  // What one provider's bill for the period starting `from` is made of: purchases in the period, and
  // each instalment purchase's share for it.
  function laterItems(txs, from, prov, cs) {
    prov = prov || GRAB;
    var to = periodEnd(from), out = [];
    (txs || []).forEach(function (t) {
      if (!t || t.t !== 'exp' || t.pm !== 'later' || provOf(t) !== prov) return;
      if (parts(t.inst && t.inst.n) > 1) {
        instShares(t, cs).forEach(function (sh) { if (sh.from === from) out.push(Object.assign({}, t, { amt: sh.amt, _inst: sh.k + ' of ' + sh.n, _full: t.amt, split: null })); });
      } else if (t.d >= from && t.d <= to) out.push(t);
    });
    return out.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
  }
  function billFor(bills, from, prov) { prov = prov || GRAB; return (bills || []).filter(function (b) { return b.from === from && billProv(b) === prov; })[0] || null; }
  function billTotal(txs, b, cs) { return r2(sum(laterItems(txs, b.from, billProv(b), cs), function (t) { return t.amt; })); }
  function billDue(txs, b, cs) { return r2(billTotal(txs, b, cs) + num(b.fee)); }
  function billPaid(b) { return r2(sum(b.payments || [], function (p) { return num(p && p.amt); })); }
  function billLeft(txs, b, cs) { return r2(billDue(txs, b, cs) - billPaid(b)); }
  // A bill's monthly payments: n equal ones (the last takes the rounding) from `first`, or from the month
  // after the period ends. Payments made so far cover them in order.
  function billSchedule(txs, b, cs) {
    var n = parts(b.n), due = billDue(txs, b, cs), each = r2(due / n), out = [], paid = billPaid(b), end = periodEnd(b.from);
    var first = b.first || (addMonth(monthOf(end), 1) + '-' + pad2(Math.min(28, +end.slice(8, 10))));
    for (var i = 0; i < n; i++) {
      var amt = i === n - 1 ? r2(due - each * (n - 1)) : each;
      var covered = Math.min(amt, Math.max(0, paid - each * i));
      out.push({ i: i, d: instalmentDate(first, i), amt: amt, part: r2(covered), paid: covered >= amt - 0.01 });
    }
    return out;
  }
  // Every statement period a provider has purchases, instalment shares or a bill in, newest first.
  function laterPeriods(txs, bills, prov, cs) {
    prov = prov || GRAB;
    var ps = bag();
    (txs || []).forEach(function (t) {
      if (!t || t.t !== 'exp' || t.pm !== 'later' || provOf(t) !== prov) return;
      if (parts(t.inst && t.inst.n) > 1) instShares(t, cs).forEach(function (sh) { ps[sh.from] = 1; });
      else ps[periodStart(t.d, cs)] = 1;
    });
    (bills || []).forEach(function (b) { if (billProv(b) === prov) ps[b.from] = 1; });
    return Object.keys(ps).sort().reverse();
  }
  // What you still owe one provider: each period's bill less what you paid on it, or, with no bill
  // yet, what you bought in it.
  function laterOwed(txs, bills, prov, cs) {
    return r2(sum(laterPeriods(txs, bills, prov, cs), function (f) {
      var b = billFor(bills, f, prov);
      return b ? billLeft(txs, b, cs) : r2(sum(laterItems(txs, f, prov, cs), function (t) { return t.amt; }));
    }));
  }

  // ---- wallets: what moved each one's money, and its balance on any day ----
  // D is the ledger: { tx: every transaction, ledger: investment entries, debts: People entries,
  // bills: PayLater bills }. A balance count c is a snapshot of the moment it was saved: an entry on
  // its day is after it only if it was logged later (afterCount in dates.js).
  function flowAfter(c, f) { var r = f.ref || {}; return afterCount(c, { d: f.d, id: r.id, at: r.at, gapOf: r.gapOf }); }
  // The net change to all your money after count c, up to day upTo. Transfers leave the total as it was,
  // prop firm mirrors carry no cash, and a People entry made by a split bill or by investing someone's
  // capital moved no money of its own (the transaction or ledger entry did).
  function flowsSince(c, D, upTo) {
    var n = 0;
    (D.tx || []).forEach(function (t) {
      if (!afterCount(c, t) || (upTo && t.d > upTo) || t.t === 'xfer' || t.propOf) return;
      n += t.t === 'exp' ? -t.amt : t.amt; // full amount: the cash really did leave
    });
    (D.ledger || []).forEach(function (e) { if (afterCount(c, e) && (!upTo || e.d <= upTo) && e.f !== 'bal') n += e.f === 'out' ? e.amt : -e.amt; });
    (D.debts || []).forEach(function (e) { if (!e.txId && !e.ledgerId && afterCount(c, e) && (!upTo || e.d <= upTo)) n -= e.amt; });
    return n;
  }
  // Every entry that moves a wallet's money, signed, after count a and up to count b; with no b, up to
  // day upTo, so an entry dated in the future hasn't moved anything yet. An entry naming no wallet, or
  // one not in `wallets`, comes back with acct null; skip marks those that leave the total unexplained
  // without being a mistake (transfers, bill payments, finance fees).
  function walletMoves(D, wallets, a, b, upTo) {
    var ok = bag(), out = []; (wallets || []).forEach(function (n) { ok[n] = 1; });
    function add(o) {
      if (!flowAfter(a, o) || (b ? flowAfter(b, o) : upTo && o.d > upTo)) return;
      if (typeof o.acct !== 'string' || !ok[o.acct]) o.acct = null;
      out.push(o);
    }
    (D.tx || []).forEach(function (t) {
      if (t.t === 'xfer') { add({ kind: 'xfer', ref: t, d: t.d, amt: -t.amt, acct: t.from, skip: 1 }); add({ kind: 'xfer', ref: t, d: t.d, amt: t.amt, acct: t.to, skip: 1 }); return; }
      if (t.pm === 'later' || t.propOf) return;
      add({ kind: 'tx', ref: t, d: t.d, amt: t.t === 'exp' ? -t.amt : t.amt, acct: t.acct, skip: !!(t.feeOf || /Finance fees/.test(t.cat || '')) });
    });
    (D.ledger || []).forEach(function (e) { if (e.f !== 'bal') add({ kind: 'inv', ref: e, d: e.d, amt: e.f === 'out' ? e.amt : -e.amt, acct: e.acct }); });
    (D.bills || []).forEach(function (bl) { (bl.payments || []).forEach(function (q) { add({ kind: 'bill', ref: q, d: q.d, amt: -num(q.amt), acct: q.from, skip: 1 }); }); });
    (D.debts || []).forEach(function (x) { if (!x.txId && !x.ledgerId) add({ kind: 'debt', ref: x, d: x.d, amt: -x.amt, acct: x.acct }); });
    return out;
  }
  // One wallet's money in and out, signed, newest first. The same rules as walletMoves, seen from one
  // wallet: src says where each came from ('xfer-out', 'xfer-in', 'tx', 'inv', 'debt', or 'bill' with
  // its provider, one per payment made in one go).
  function walletFlows(D, n) {
    var out = [];
    (D.tx || []).forEach(function (t) {
      if (t.t === 'xfer') {
        if (t.from === n) out.push({ d: t.d, ref: t, amt: -t.amt, src: 'xfer-out' });
        if (t.to === n) out.push({ d: t.d, ref: t, amt: t.amt, src: 'xfer-in' });
        return;
      }
      if (t.pm === 'later' || t.acct !== n || t.propOf) return;
      out.push({ d: t.d, ref: t, amt: t.t === 'exp' ? -t.amt : t.amt, src: 'tx' });
    });
    (D.ledger || []).forEach(function (e) { if (e.acct === n && e.f !== 'bal') out.push({ d: e.d, ref: e, amt: e.f === 'out' ? e.amt : -e.amt, src: 'inv' }); });
    (D.debts || []).forEach(function (x) { if (x.acct === n && !x.txId && !x.ledgerId) out.push({ d: x.d, ref: x, amt: -x.amt, src: 'debt' }); });
    var lumps = bag(), order = [];
    (D.bills || []).forEach(function (b) {
      (b.payments || []).forEach(function (p) {
        if (p.from !== n) return; var k = String(p.payId || p.id);
        if (!lumps[k]) { lumps[k] = { d: p.d, ref: p, amt: 0, src: 'bill', prov: billProv(b), k: k }; order.push(k); }
        lumps[k].amt = r2(lumps[k].amt + num(p.amt));
      });
    });
    order.forEach(function (k) { var L = lumps[k]; L.amt = -L.amt; out.push(L); });
    return out.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; });
  }
  // A wallet's balance on any day, anchored to the latest count that has a figure for it (checks
  // sorted oldest first). With no count only the change is known, so the figures are relative.
  function walletModel(flows, checks, n, day) {
    var anchorC = null, anchor = null;
    (checks || []).slice().reverse().some(function (c) { if (c && c.lines && Object.prototype.hasOwnProperty.call(c.lines, n) && c.lines[n] != null) { anchorC = c; anchor = num(c.lines[n]); return true; } return false; });
    function amt(f) { return f.amt; }
    function balOn(d) {
      if (!anchorC) return r2(sum(flows.filter(function (f) { return f.d <= d; }), amt));
      if (d >= anchorC.d) return r2(anchor + sum(flows.filter(function (f) { return flowAfter(anchorC, f) && f.d <= d; }), amt));
      return r2(anchor - sum(flows.filter(function (f) { return f.d > d && !flowAfter(anchorC, f); }), amt));
    }
    return { flows: flows, anchorC: anchorC, anchorD: anchorC ? anchorC.d : null, anchor: anchor, balOn: balOn, now: balOn(day) };
  }

  return {
    r2: r2, sum: sum, num: num, cleanTx: cleanTx, cleanDebts: cleanDebts, cleanLedger: cleanLedger, ea: ea, catKind: catKind, monthStats: monthStats, incomeBy: incomeBy, tagSpend: tagSpend,
    venueType: venueType, isClosed: isClosed, cashBasis: cashBasis, venuePnl: venuePnl,
    personBalances: personBalances, monthlyEquiv: monthlyEquiv, changeOk: changeOk,
    GRAB: GRAB, provOf: provOf, billProv: billProv, periodStart: periodStart, periodEnd: periodEnd, instShares: instShares, laterItems: laterItems,
    billFor: billFor, billTotal: billTotal, billDue: billDue, billPaid: billPaid, billLeft: billLeft, billSchedule: billSchedule, laterPeriods: laterPeriods, laterOwed: laterOwed,
    flowAfter: flowAfter, flowsSince: flowsSince, walletMoves: walletMoves, walletFlows: walletFlows, walletModel: walletModel
  };
})();
