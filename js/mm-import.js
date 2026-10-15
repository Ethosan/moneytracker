// ---- Money Manager import mapper ----
var MM = (function () {
  var CAT_MAP = {
    'dates': '💝 Dates', 'help others buy': '🤝 Help others', 'Games': '🎮 Games',
    '❤️ mummy': '👨‍👩‍👧 Family', 'Other': '📦 Other', '👬 Social Life': '👬 Social life',
    '✌️😭 interest': '💹 Interest', 'Debt payments': '↩️ Paybacks', '💵 Petty cash': '💵 Petty cash'
  };
  var INC_KIND = {
    '📖 Tutoring': 'earned', '💼 Salary': 'earned', '🌐 Website': 'earned', '🤑 Allowance': 'earned',
    '💹 Interest': 'earned', '🏅 Bonus': 'other', '↩️ Paybacks': 'reimb', '💵 Petty cash': 'reimb'
  };
  var VENUES = {
    'Moomoo': ['Moomoo', 'broker'], 'IG': ['IG', 'broker'], 'IBKR injections/withdrawals': ['IBKR', 'broker'],
    'Etoro': ['eToro', 'broker'], 'Webull': ['Webull', 'broker'], 'Forex.com': ['Forex.com', 'broker'],
    'HFM': ['HFM', 'broker'], 'AMP FUTURES': ['AMP Futures', 'broker'], 'Crypto': ['Crypto', 'crypto'],
    'Poker': ['Poker', 'poker']
  };
  var STOP = ['owe', 'owes', 'borrow', 'from', 'lend', 'me', 'money', 'pay', 'back', 'anytime', 'during', 'ns',
    'will', 'on', 'cny', 'i', 'to', 'the', 'for'];
  // SheetJS 0.18 truncates astral XML entities (emoji) to 16 bits; restore them.
  function fixMoji(s) {
    var o = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      o += (c >= 0xF000 && c <= 0xFAFF) ? String.fromCodePoint(0x10000 + c) : s.charAt(i);
    }
    return o;
  }
  function clean(s) { return fixMoji(s == null ? '' : String(s)).trim(); }
  function propName(note) {
    var n = note.toLowerCase();
    if (n.indexOf('apex') > -1) return 'Apex';
    if (n.indexOf('tradeify') > -1) return 'Tradeify';
    if (n.indexOf('lucid') > -1) return 'Lucid';
    if (n.indexOf('my funded') > -1) return 'MyFundedFutures';
    if (n.indexOf('instant') > -1) return 'Instant Funding';
    return note ? note.split(' ')[0] : 'Prop firm';
  }
  function person(note) {
    if (note.indexOf('(') > -1) return note.split('(')[0].trim();
    var w = note.split(/\s+/).filter(function (x) { return x && STOP.indexOf(x.toLowerCase()) < 0; });
    var p = w[0] || 'Unknown';
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }
  function dateOf(v, XLSX) {
    if (typeof v === 'number') {
      var c = XLSX.SSF.parse_date_code(v);
      return c.y + '-' + String(c.m).padStart(2, '0') + '-' + String(c.d).padStart(2, '0');
    }
    var s = clean(v);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return null;
  }
  // Find the header row and work out which column is which. Money Manager's
  // exports differ by version, currency and locale, so never trust fixed positions.
  function layout(rows) {
    var L = null;
    for (var i = 0; i < Math.min(rows.length, 12) && !L; i++) {
      var r = rows[i] || [], h = r.map(function (x) { return clean(x).toLowerCase(); });
      var col = { date: -1, account: -1, cat: -1, sub: -1, note: -1, amt: -1, cur: -1, type: -1, desc: -1 };
      h.forEach(function (v, j) {
        var raw = clean(r[j]);
        if (col.date < 0 && /^(date|period|time)/.test(v)) col.date = j;
        else if (col.account < 0 && /account/.test(v)) col.account = j;
        else if (col.cat < 0 && /^categor/.test(v)) col.cat = j;
        else if (col.sub < 0 && /sub.?categor/.test(v)) col.sub = j;
        else if (col.note < 0 && /^(note|memo|remark|title)/.test(v)) col.note = j;
        else if (col.type < 0 && /(income.*expense|^type$|transaction type)/.test(v)) col.type = j;
        else if (col.desc < 0 && /descri/.test(v)) col.desc = j;
        else if (col.cur < 0 && /^currency$/.test(v)) col.cur = j;
        else if (/^[a-z]{3}$/.test(v) && /^[A-Z]{3}$/.test(raw)) { if (col.amt < 0) col.amt = j; }
        else if (col.amt < 0 && /(amount|value|total)/.test(v)) col.amt = j;
      });
      if (col.amt < 0) h.forEach(function (v, j) { if (col.amt < 0 && /(amount|value|total)/.test(v)) col.amt = j; });
      if (col.date > -1 && col.amt > -1 && col.type > -1) { col.header = i; L = col; }
    }
    return L;
  }
  // rows: array of arrays incl. header row
  function map(rows, XLSX) {
    var out = { tx: [], ledger: [], debts: [], venues: {}, cats: {}, skipped: 0, headers: [] };
    var n = 0;
    function id() { n++; return 'mm' + n; }
    var L = layout(rows);
    if (!L) { L = { header: 0, date: 0, account: 1, cat: 2, sub: 3, note: 4, amt: 5, type: 6, desc: 7 }; out.guessed = true; }
    out.headers = (rows[L.header] || []).map(function (x) { return clean(x); }).filter(Boolean);
    function cell(r, j) { return j > -1 && j < r.length ? r[j] : ''; }
    for (var i = L.header + 1; i < rows.length; i++) {
      var r = rows[i]; if (!r || !r.length) continue;
      var d = dateOf(cell(r, L.date), XLSX), acct = clean(cell(r, L.account)), cat = clean(cell(r, L.cat)), sub = clean(cell(r, L.sub)),
        note = clean(cell(r, L.note)) || clean(cell(r, L.desc)),
        raw = cell(r, L.amt), amt = Math.abs(typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))),
        type = clean(cell(r, L.type));
      if (!type && amt) type = (typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))) < 0 ? 'Expense' : 'Income';
      if (/^expense/i.test(type)) type = 'Expense'; else if (/^income/i.test(type)) type = 'Income';
      else if (/transfer.?out|^out$/i.test(type)) type = 'Transfer-Out'; else if (/transfer.?in|^in$/i.test(type)) type = 'Transfer-In';
      if (!d || !(amt > 0)) { out.skipped++; continue; }
      amt = Math.round(amt * 100) / 100;
      if (type === 'Expense' || type === 'Income') {
        var c = CAT_MAP[cat] || cat;
        var t = type === 'Expense' ? 'exp' : 'inc';
        var tags = [];
        var mpt = personTag(); if (mpt && (c === '💝 Dates' || String(note || '').toLowerCase().indexOf(mpt.toLowerCase()) > -1) && tags.indexOf(mpt) < 0) tags.push(mpt);
        out.cats[c] = { name: c, type: t, kind: t === 'inc' ? (INC_KIND[c] || 'other') : undefined };
        out.tx.push({ id: id(), d: d, t: t, amt: amt, cat: c, sub: sub, note: note, tags: tags, src: 'mm' });
      } else if (type === 'Transfer-Out') {
        var from = acct, to = cat;
        if (to === 'People Owe me Money' || from === 'People Owe me Money') {
          out.debts.push({ id: id(), d: d, person: person(note), amt: to === 'People Owe me Money' ? amt : -amt, note: note, src: 'mm' });
        } else if (to === 'Propfirms') {
          var pn = propName(note);
          out.venues[pn] = { name: pn, type: 'prop' };
          out.ledger.push({ id: id(), d: d, venue: pn, f: 'in', amt: amt, note: note, src: 'mm' });
        } else if (VENUES[to] || VENUES[from]) {
          var isIn = !!VENUES[to];
          var v = VENUES[isIn ? to : from];
          out.venues[v[0]] = { name: v[0], type: v[1] };
          out.ledger.push({ id: id(), d: d, venue: v[0], f: isIn ? 'in' : 'out', amt: amt, note: note, src: 'mm' });
        } else if (to === 'Misplaced balancer') {
          out.cats['❓ Unaccounted'] = { name: '❓ Unaccounted', type: 'exp' };
          out.tx.push({ id: id(), d: d, t: 'exp', amt: amt, cat: '❓ Unaccounted', sub: '', note: note || 'Unaccounted', tags: [], src: 'mm' });
        } else if (from === 'Misplaced balancer' && to === 'Cash') {
          var isFam = /clement|mummy|mum/i.test(note) && !/initial|balance/i.test(note);
          if (isFam) {
            out.cats['🏅 Bonus'] = { name: '🏅 Bonus', type: 'inc', kind: 'other' };
            out.tx.push({ id: id(), d: d, t: 'inc', amt: amt, cat: '🏅 Bonus', sub: '', note: note, tags: [], src: 'mm' });
          } else {
            out.tx.push({ id: id(), d: d, t: 'adj', amt: amt, cat: '🔧 Adjustment', sub: '', note: note, tags: [], src: 'mm' });
          }
        } else { out.skipped++; }
      } else { out.skipped++; }
    }
    return out;
  }
  return { map: map };
})();
