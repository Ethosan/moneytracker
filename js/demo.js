// A made-up ledger for the demo (index.html?demo). Six months up to today, the same every time for the
// same day, so screenshots and the tests see the same figures. Nothing here is anyone's real money.
(function (root) {
  'use strict';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  // a small seeded generator (mulberry32), so the demo is the same on every device
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var CATS = [
    ['🍜 Food', 'exp'], ['🚖 Transport', 'exp'], ['💝 Dates', 'exp'], ['🗓 Subscriptions', 'exp'], ['🧥 Shopping', 'exp'],
    ['👨‍👩‍👧 Family', 'exp'], ['🙏 Giving', 'exp'], ['🎁 Gift', 'exp'], ['🎮 Games', 'exp'], ['👬 Social life', 'exp'],
    ['🎟 Experiences', 'exp'], ['📦 Other', 'exp'],
    ['📖 Tutoring', 'inc', 'earned'], ['💼 Salary', 'inc', 'earned'], ['💹 Interest', 'inc', 'earned'],
    ['🏅 Bonus', 'inc', 'other'], ['↩️ Paybacks', 'inc', 'reimb']
  ];
  var FOOD = [['Hawker', 'Chicken rice', 4.5, 7], ['Hawker', 'Laksa', 5, 7.5], ['Hawker', 'Mixed rice', 4.8, 7], ['Cafe', 'Kopi and kaya toast', 3.6, 5.8],
    ['Cafe', 'Flat white', 5.5, 7.5], ['Groceries', 'FairPrice', 18, 64], ['Delivery', 'GrabFood', 14, 29], ['Hawker', 'Mee pok', 4, 6]];
  var RIDES = [['MRT', 'Bus and MRT', 1.2, 2.6], ['MRT', 'Bus and MRT', 1.4, 2.4], ['MRT', 'Bus and MRT', 1.1, 2.2], ['Grab', 'Grab home', 11, 24]];
  var SHOP = [['Clothes', 'Uniqlo', 29.9, 69.9], ['Home', 'Shopee', 8.9, 42], ['Tech', 'USB-C cable', 12.9, 25.9], ['Books', 'Kinokuniya', 18, 36]];

  function build(today) {
    var ty = +today.slice(0, 4), tm = +today.slice(5, 7), td = +today.slice(8, 10);
    var tx = {}, debts = [], ledger = [], n = 0;
    function id(p) { n++; return 'demo-' + p + n; }
    function add(d, t, amt, cat, sub, note, more) {
      if (d > today) return null;
      var m = d.slice(0, 7), row = { id: id('t'), d: d, t: t, amt: r2(amt), cat: cat, sub: sub || '', note: note || '', tags: [], src: 'demo' };
      if (more) for (var k in more) row[k] = more[k];
      (tx[m] = tx[m] || []).push(row);
      return row;
    }
    // the six months ending this one, oldest first
    var months = [];
    for (var k = 5; k >= 0; k--) { var y = ty, mm = tm - k; while (mm < 1) { mm += 12; y--; } months.push([y, mm]); }

    months.forEach(function (ym, i) {
      var y = ym[0], m = ym[1], last = daysIn(y, m), R = rng(y * 100 + m);
      var pick = function (a) { return a[Math.floor(R() * a.length)]; };
      var between = function (lo, hi) { return lo + R() * (hi - lo); };
      // income
      add(ymd(y, m, 25), 'inc', 2900, '💼 Salary', '', 'Pay, ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1], { acct: 'DBS' });
      [6, 13, 20, 27].forEach(function (d) { if (d <= last) add(ymd(y, m, d), 'inc', 60, '📖 Tutoring', 'Sec 3 maths', 'Weekly lesson', { acct: 'Cash' }); });
      add(ymd(y, m, last), 'inc', r2(3.2 + R() * 1.6), '💹 Interest', '', 'DBS Multiplier interest', { acct: 'DBS' });
      if (i === 2) add(ymd(y, m, 15), 'inc', 800, '🏅 Bonus', '', 'Half-year bonus', { acct: 'DBS' });
      // regular payments
      add(ymd(y, m, 1), 'exp', 500, '👨‍👩‍👧 Family', 'Parents', 'Monthly to Mum', { acct: 'DBS' });
      add(ymd(y, m, 3), 'exp', 10.98, '🗓 Subscriptions', 'Spotify', 'Spotify Premium', { acct: 'DBS' });
      add(ymd(y, m, 9), 'exp', 3.98, '🗓 Subscriptions', 'iCloud', 'iCloud 200 GB', { acct: 'DBS' });
      add(ymd(y, m, 18), 'exp', 28.13, '🗓 Subscriptions', 'Claude', 'Claude Pro', { acct: 'DBS' });
      add(ymd(y, m, 12), 'exp', 30, '🗓 Subscriptions', 'Phone', 'GOMO mobile plan', { acct: 'DBS' });
      // every day: food, and getting around on weekdays
      for (var d = 1; d <= last; d++) {
        var day = ymd(y, m, d), dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        var meals = R() < 0.35 ? 2 : 1;
        for (var j = 0; j < meals; j++) { var f = pick(FOOD); add(day, 'exp', between(f[2], f[3]), '🍜 Food', f[0], f[1], { acct: R() < 0.4 ? 'Cash' : 'DBS' }); }
        if (dow > 0 && dow < 6) { var r = R() < 0.12 ? RIDES[3] : pick(RIDES.slice(0, 3)); add(day, 'exp', between(r[2], r[3]), '🚖 Transport', r[0], r[1], { acct: 'DBS' }); }
      }
      // dates with Mei, tagged so the Mei lens has something in it
      [8, 22].forEach(function (d) {
        var row = add(ymd(y, m, d), 'exp', between(38, 92), '💝 Dates', pick(['Dinner', 'Movie', 'Cafe']), pick(['Dinner at Tiong Bahru', 'Movie at Jewel', 'Brunch in Joo Chiat', 'Omakase, shared']), { acct: 'DBS' });
        if (row) row.tags = ['Mei'];
      });
      // now and then
      if (R() < 0.8) { var s = pick(SHOP); add(ymd(y, m, 4 + Math.floor(R() * 20)), 'exp', between(s[2], s[3]), '🧥 Shopping', s[0], s[1], { acct: 'DBS' }); }
      if (R() < 0.6) add(ymd(y, m, 10 + Math.floor(R() * 15)), 'exp', between(25, 60), '👬 Social life', 'Drinks', 'Drinks with the team', { acct: 'DBS' });
      if (i === 1) add(ymd(y, m, 19), 'exp', 128, '🎟 Experiences', 'Concert', 'Concert tickets', { acct: 'DBS' });
      if (i === 3) add(ymd(y, m, 14), 'exp', 69.9, '🎮 Games', '', 'New Switch game', { acct: 'DBS' });
      if (i === 4) add(ymd(y, m, 2), 'exp', 50, '🙏 Giving', '', 'Food bank donation', { acct: 'DBS' });
      // a shared dinner each month: you paid, Sam owes their half, and pays it back a few days later
      var sd = ymd(y, m, 16), whole = r2(between(70, 130)), half = r2(whole / 2);
      var shared = add(sd, 'exp', whole, '🍜 Food', 'Restaurant', 'Dinner with Sam', { acct: 'DBS', split: { mine: half, person: 'Sam' } });
      if (shared) {
        debts.push({ id: id('d'), txId: shared.id, d: sd, person: 'Sam', amt: half, note: 'Dinner with Sam, their share', src: 'app' });
        var back = ymd(y, m, Math.min(last, 20));
        // the payback is income and also clears Sam's balance; txId ties the two, so it is not counted twice
        var paid = add(back, 'inc', half, '↩️ Paybacks', '', 'Sam paid back', { acct: 'DBS' });
        if (paid) debts.push({ id: id('d'), txId: paid.id, d: back, person: 'Sam', amt: -half, note: 'Paid back', src: 'app' });
      }
      // a little into the broker every month
      if (ymd(y, m, 26) <= today) ledger.push({ id: id('l'), d: ymd(y, m, 26), venue: 'Moomoo', f: 'in', amt: 300, note: 'Monthly top-up', acct: 'DBS' });
    });

    // investments and the rest, dated from the first month
    var f0 = months[0], f1 = months[1], f3 = months[3], f4 = months[4];
    ledger.push({ id: id('l'), d: ymd(f0[0], f0[1], 1), venue: 'Moomoo', f: 'bal', amt: 5200, note: 'Starting balance' });
    ledger.push({ id: id('l'), d: ymd(f4[0], f4[1], 28), venue: 'Moomoo', f: 'bal', amt: 7140.55, note: 'From the app' });
    ledger.push({ id: id('l'), d: ymd(f1[0], f1[1], 5), venue: 'Apex', f: 'in', amt: 167, note: 'Evaluation, 50K', acct: 'DBS' });
    ledger.push({ id: id('l'), d: ymd(f3[0], f3[1], 11), venue: 'Apex', f: 'out', amt: 612.4, note: 'First payout', acct: 'DBS' });
    ledger.push({ id: id('l'), d: ymd(f0[0], f0[1], 3), venue: 'Coinbase', f: 'bal', amt: 950, note: 'Starting balance' });
    ledger.push({ id: id('l'), d: ymd(f3[0], f3[1], 20), venue: 'Coinbase', f: 'bal', amt: 1088.2, note: 'Checked' });
    // money lent: Jo borrowed 150 and has paid 50 back
    debts.push({ id: id('d'), d: ymd(f3[0], f3[1], 7), person: 'Jo', amt: 150, note: 'Lent for rent', k: 'lend', acct: 'DBS', src: 'app' });
    debts.push({ id: id('d'), d: ymd(f4[0], f4[1], 7), person: 'Jo', amt: -50, note: 'Part payment', k: 'part', paid: 50, acct: 'DBS', src: 'app' });

    // one count of the wallets the night before the first month, so balances have a starting point
    var py = f0[0], pm = f0[1] - 1; if (pm < 1) { pm = 12; py--; }
    var c0 = ymd(py, pm, daysIn(py, pm));
    var checks = [{ id: 'demo-c1', d: c0, at: new Date(py, pm - 1, daysIn(py, pm), 21).toISOString(), total: 4380, lines: { DBS: 4200, Cash: 180 }, native: {}, exp: {} }];

    var cats = CATS.map(function (c) { return { name: c[0], type: c[1], kind: c[2] }; });
    var nextOn = function (day) { var y = ty, m = tm; if (td >= day) { m++; if (m > 12) { m = 1; y++; } } return ymd(y, m, Math.min(day, daysIn(y, m))); };
    return {
      meta: {
        cats: cats, tags: ['Mei'], basis: 'cash', rules: [], subcats: {},
        accounts: [{ name: 'DBS', liability: false }, { name: 'Cash', liability: false }],
        venues: { Moomoo: { name: 'Moomoo', type: 'broker' }, Apex: { name: 'Apex', type: 'prop' }, Coinbase: { name: 'Coinbase', type: 'crypto' } },
        budgets: [{ key: 'cat:🍜 Food', amt: 650 }, { key: 'cat:🚖 Transport', amt: 120 }, { key: 'cat:🧥 Shopping', amt: 100 }],
        subs: [
          { id: 'demo-s1', name: 'Spotify', amt: 10.98, cycle: 1, next: nextOn(3), active: true },
          { id: 'demo-s2', name: 'iCloud', amt: 3.98, cycle: 1, next: nextOn(9), active: true },
          { id: 'demo-s3', name: 'GOMO', amt: 30, cycle: 1, next: nextOn(12), active: true },
          { id: 'demo-s4', name: 'Claude', amt: 28.13, cycle: 1, next: nextOn(18), active: true }
        ],
        demo: true
      },
      tx: tx, ledger: ledger, debts: debts, inbox: [], checks: checks, bills: [], chats: []
    };
  }

  root.Demo = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
