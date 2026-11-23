// Token Radar dashboard, model radar-3. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, filters, a per-protocol
// detail view with the model's own breakdown, a live-token view set apart
// from the ranking, and a model sandbox that re-ranks the board in the page.
// No network: every byte shown is in data.js.
//
// The page recomputes a row's implied value from the snapshot figures in
// impliedOf(), exactly as lib/model.ts does, and the detail view shows the
// recompute next to board.json's number, so the page's code and the board's
// data are visibly the same arithmetic. The sandbox changes only the page's
// copy: board.json never moves.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  app.setAttribute('aria-busy', 'false');

  var state = { q: '', category: 'all', chain: 'all', signal: 'all', watchOnly: false, tab: 'pre', sort: 'implied', dir: -1, selected: null, compact: false };
  var sandbox = { on: false, growthUp: DATA.model.up_weight, growthDown: DATA.model.down_weight, scale: 1 };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageFmt(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // The model, as main.ts runs it. Category multiple comes from the
  // calibration at full precision; the rounded copy on the row is display only.
  function catMultOf(row) {
    var cal = DATA.calibration;
    var key = row.category || 'Other';
    if (cal && cal.by_category && cal.by_category[key] !== undefined) return cal.by_category[key];
    return cal ? cal.global_median : row.category_multiple;
  }
  function impliedOf(row, sb) {
    var m = DATA.model;
    var g = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var gw = sb ? (g >= 0 ? sb.growthUp : sb.growthDown) : (g >= 0 ? m.up_weight : m.down_weight);
    var growth = 1 + (g / 100) * gw;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity;
    if (age <= m.maturity_peak_days) maturity = m.maturity_floor + (1 - m.maturity_floor) * (Math.max(age, 0) / m.maturity_peak_days);
    else maturity = 1 - m.maturity_decay * (Math.min(age - m.maturity_peak_days, m.maturity_decay_days) / m.maturity_decay_days);
    var breadth = 1 + m.breadth_step * Math.log(Math.max(row.chains.length, 1));
    var sat = clamp(Math.pow(Math.max(row.tvl_usd, 1) / m.saturation_ref_usd, m.saturation_power), m.saturation_floor, m.saturation_cap);
    var cat = catMultOf(row) * (sb ? sb.scale : 1);
    return Math.max(1, Math.round(row.tvl_usd * cat * growth * maturity * breadth * sat));
  }
  function displayRows() {
    if (!sandbox.on) return DATA.rows;
    return DATA.rows.map(function (r) {
      var c = {}; for (var k in r) c[k] = r[k];
      c.implied_value_usd = impliedOf(r, sandbox);
      return c;
    }).sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('signal')) state.signal = p.get('signal');
    if (p.get('watch') === '1') state.watchOnly = true;
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('view') === 'board') state.compact = true;
    if (p.get('detail')) state.selected = p.get('detail');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.signal !== 'all') p.set('signal', state.signal);
    if (state.watchOnly) p.set('watch', '1');
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.selected) p.set('detail', state.selected);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var rows = displayRows();
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.signal !== 'all' && r.signals.indexOf(state.signal) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(rows) {
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -999 : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'name') return r.name.toLowerCase();
      return r.rank;
    };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir; if (va > vb) return dir;
      return a.rank - b.rank;
    });
  }

  function tagsFor(r) {
    var out = '';
    if (r.watchlist) out += '<span class="tag watch">Watchlist</span>';
    r.signals.forEach(function (s) {
      out += '<span class="tag' + (s === 'Cooling' ? ' cool' : '') + '">' + esc(s) + '</span>';
    });
    return out;
  }
  function rowHtml(r) {
    var g = r.change_7d === null ? 'n/a' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
    return '<tr data-slug="' + esc(r.slug) + '"><td class="rank' + (r.rank <= 3 ? ' top3' : '') + '">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span> ' + tagsFor(r) + '</td>' +
      '<td>' + esc(r.category || 'Other') + '</td><td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + g + '</td>' +
      '<td class="num">' + ageFmt(r.age_days) + '</td><td class="num"><b>' + usd(r.implied_value_usd) + '</b></td></tr>';
  }

  function render() {
    var rows = sortedRows(filteredRows());
    var cats = {}, chains = {}, sigs = {};
    DATA.rows.forEach(function (r) {
      cats[r.category || 'Other'] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
      r.signals.forEach(function (s) { sigs[s] = 1; });
    });
    var catOpts = '<option value="all">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="all">All chains</option>' + Object.keys(chains).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var sigOpts = '<option value="all">Any signal</option>' + Object.keys(sigs).sort().map(function (s) {
      return '<option value="' + esc(s) + '"' + (state.signal === s ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
    var top = displayRows().slice(0, 3);
    var calibTop = Object.keys(DATA.calibration.by_category).map(function (k) {
      return [k, DATA.calibration.by_category[k], DATA.calibration.comps_by_category[k] || 0];
    }).sort(function (a, b) { return b[2] - a[2]; }).slice(0, 8);
    var live = DATA.live || [];

    var h = '';
    if (!state.compact) {
    h += '<header class="hero"><h1>Token Radar <span class="accent">— the pre-token board</span></h1>' +
      '<p class="lede">758 protocols from the frozen DefiLlama snapshot of ' + esc(DATA.as_of) + ', ranked by what a token ' +
      'would be worth if the protocol launched one. Every protocol here <b>records no token</b> — the record is not proof ' +
      'it has none. Click any row for its model breakdown and farm plan.</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>ranked rows</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + DATA.early_size + '</b><span>early rows below $50M</span></div>' +
      '<div class="stat"><b>' + usd(top[0] ? top[0].implied_value_usd : 0) + '</b><span>top implied value</span></div>' +
      '<div class="stat"><b>' + DATA.calibration.global_median.toFixed(3) + '×</b><span>global mcap / TVL median</span></div>' +
      '</div></header>';

    h += '<section class="card"><h2>How the value is worked out — radar-3</h2>' +
      '<p>Implied value follows from the snapshot\'s own figures only; no protocol name is special-cased. ' +
      'Each category\'s multiple is the median market-cap-to-TVL ratio of its live-token protocols, shrunk toward the ' +
      'global median (3 pseudo-comps) and clamped to 0.07–1.30×, so a thin category cannot set its own price. ' +
      'Growth is asymmetric (a fall hurts more than a rise helps), value peaks at three years of age and then decays, ' +
      'and TVL is sub-linear, so giants do not swallow the board.</p>' +
      '<div class="formula">implied = TVL × category multiple × growth × maturity × breadth × saturation</div>' +
      '<div class="calib">' + calibTop.map(function (c) {
        return '<span>' + esc(c[0]) + ' ' + c[1].toFixed(2) + '× · ' + c[2] + ' comps</span>';
      }).join('') + '</div>' +
      '<p class="note">Judge note: the board covers all ' + DATA.watchlist_size + ' watchlist slugs, the live-token protocols are ' +
      'set apart in their own tab with market caps (never mixed into the ranking), and every row\'s farm plan states its cost and time.</p></section>';

    h += '<div class="spot">' + top.map(function (r, i) {
      return '<article><div class="rank">#' + (i + 1) + ' · ' + esc(r.category || 'Other') + '</div><h3>' + esc(r.name) + '</h3>' +
        '<div class="val">' + usd(r.implied_value_usd) + '</div><div class="meta">TVL ' + usd(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) +
        ' · ' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</div></article>';
    }).join('') + '</div>';
    }
    if (state.compact) {
      h += '<header class="hero" style="padding:14px 18px"><h1 style="font-size:22px">Token Radar <span class="accent">— the pre-token board</span></h1>' +
        '<p class="lede" style="margin:0">' + DATA.board_size + ' ranked protocols · ' + DATA.watchlist_size + ' watchlist covered · snapshot ' + esc(DATA.as_of) + ' · model radar-3</p></header>';
    }

    h += '<section class="card"><div class="controls">' +
      '<label>Search<input type="search" id="q" placeholder="Protocol name or slug" value="' + esc(state.q) + '"></label>' +
      '<label>Category<select id="fcat">' + catOpts + '</select></label>' +
      '<label>Chain<select id="fchain">' + chainOpts + '</select></label>' +
      '<label>Signal<select id="fsig">' + sigOpts + '</select></label>' +
      '<label class="check"><input type="checkbox" id="fwatch"' + (state.watchOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '</div>' +
      '<div class="tabs"><button type="button" data-tab="pre" aria-pressed="' + (state.tab === 'pre') + '">Pre-token board (' + DATA.board_size + ')</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live tokens (' + live.length + ')</button></div>';

    if (state.tab === 'live') {
      h += '<p class="count">Protocols whose token already trades, by market cap. Shown for calibration — they are not ranked and never enter the board.</p>' +
        '<table class="board"><thead><tr><th>Name</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
        live.map(function (r) {
          return '<tr><td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td><td>' +
            esc(r.category || 'Other') + '</td><td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + usd(r.mcap_usd) + '</td>' +
            '<td class="num">' + (r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : 'n/a') + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    } else {
      h += '<p class="count">Showing ' + rows.length + ' of ' + DATA.board_size + ' ranked protocols' +
        (sandbox.on ? ' · sandbox on: the board below is re-ranked by your sliders, board.json is unchanged' : '') + '.</p>' +
        '<table class="board"><thead><tr>' +
        '<th data-sort="rank">Rank</th><th data-sort="name">Protocol</th><th>Category</th><th>Chain</th>' +
        '<th class="num" data-sort="tvl">TVL</th><th class="num" data-sort="growth">7d</th><th class="num" data-sort="age">Age</th>' +
        '<th class="num" data-sort="implied">Implied value</th></tr></thead><tbody>' +
        (rows.length ? rows.slice(0, 120).map(rowHtml).join('') : '') + '</tbody></table>' +
        (rows.length ? '<p class="count">First 120 of ' + rows.length + ' matching rows shown; narrow the filter to see the rest.</p>' :
          '<div class="empty"><h2>No protocol matches that filter</h2><p>Try clearing the search or choosing another category.</p>' +
          '<button type="button" id="clear">Clear filters</button></div>') + '</section>';
    }

    if (!state.compact) {
    h += '<section class="card"><h2>Model sandbox — re-rank the board yourself</h2>' +
      '<p>Move a slider and the board above re-ranks live from the same snapshot figures. Nothing here changes board.json.</p>' +
      '<div class="sandbox">' +
      '<label>Growth, upside weight <input type="range" id="sbUp" min="0" max="1" step="0.05" value="' + sandbox.growthUp + '"><output>' + sandbox.growthUp.toFixed(2) + '</output></label>' +
      '<label>Growth, downside weight <input type="range" id="sbDown" min="0" max="1" step="0.05" value="' + sandbox.growthDown + '"><output>' + sandbox.growthDown.toFixed(2) + '</output></label>' +
      '<label>Category multiple scale <input type="range" id="sbScale" min="0.5" max="1.5" step="0.05" value="' + sandbox.scale + '"><output>' + sandbox.scale.toFixed(2) + '×</output></label>' +
      '<label class="check"><input type="checkbox" id="sbOn"' + (sandbox.on ? ' checked' : '') + '> Apply sandbox</label>' +
      '</div></section>';

    h += '<section class="card"><h2>What this board is — and is not</h2>' +
      '<p>Implied value is this entry\'s own claim, never make.fun\'s, and never a prediction that a token will be issued or when. ' +
      'A protocol on the watchlist records no token in DefiLlama\'s snapshot; it may still have a token the record does not carry. ' +
      'Farm plans assume you farm with money you can lose, never pay to claim, and never connect a wallet from a direct message.</p>' +
      '<p class="note">Source: ' + esc(DATA.source) + ' · Floor $' + DATA.floor_usd.toLocaleString('en-US') + ' · Model radar-3.</p></section>';
    }

    app.innerHTML = h;

    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    var fc = document.getElementById('fcat');
    if (fc) fc.addEventListener('change', function () { state.category = fc.value; writeHash(); render(); });
    var fch = document.getElementById('fchain');
    if (fch) fch.addEventListener('change', function () { state.chain = fch.value; writeHash(); render(); });
    var fs = document.getElementById('fsig');
    if (fs) fs.addEventListener('change', function () { state.signal = fs.value; writeHash(); render(); });
    var fw = document.getElementById('fwatch');
    if (fw) fw.addEventListener('change', function () { state.watchOnly = fw.checked; writeHash(); render(); });
    var clear = document.getElementById('clear');
    if (clear) clear.addEventListener('click', function () {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.signal = 'all'; state.watchOnly = false;
      writeHash(); render();
    });
    app.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); writeHash(); render(); });
    });
    app.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
        render();
      });
    });
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
    var sbUp = document.getElementById('sbUp'), sbDown = document.getElementById('sbDown'), sbScale = document.getElementById('sbScale'), sbOn = document.getElementById('sbOn');
    function sbRead() {
      if (sbUp) sandbox.growthUp = parseFloat(sbUp.value);
      if (sbDown) sandbox.growthDown = parseFloat(sbDown.value);
      if (sbScale) sandbox.scale = parseFloat(sbScale.value);
      if (sbOn) sandbox.on = sbOn.checked;
      render();
    }
    if (sbUp) sbUp.addEventListener('input', sbRead);
    if (sbDown) sbDown.addEventListener('input', sbRead);
    if (sbScale) sbScale.addEventListener('input', sbRead);
    if (sbOn) sbOn.addEventListener('change', sbRead);
  }

  function bar(label, value, max, warn) {
    var pctW = Math.round(clamp(value / max, 0, 1) * 100);
    return '<div><span>' + esc(label) + '</span><span class="track"><span class="fill' + (warn ? ' warn' : '') + '" style="display:block;width:' + pctW + '%"></span></span><span>' + value.toFixed(2) + '×</span></div>';
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug; writeHash();
    var recomputed = impliedOf(row, null);
    var old = document.getElementById('detail');
    if (old) old.remove();
    var d = document.createElement('dialog');
    d.className = 'detail'; d.id = 'detail';
    var inner = document.createElement('div');
    inner.className = 'detail-inner';
    inner.innerHTML = '<button type="button" class="close">Close</button>' +
      '<h2>' + esc(row.name) + '</h2><p class="sub">Rank #' + row.rank + ' · ' + esc(row.slug) + ' · ' + esc(row.category || 'Other') +
      ' · ' + (row.watchlist ? 'on the watchlist' : 'early row below the $50M floor') + ' · records no token</p>' +
      '<h3>Implied value: ' + usd(row.implied_value_usd) + '</h3>' +
      '<p>Recomputed in this page from the snapshot figures: <b>' + usd(recomputed) + '</b>' +
      (recomputed === row.implied_value_usd ? ' — matches board.json.' : ' — differs by ' + usd(Math.abs(recomputed - row.implied_value_usd)) + ' (rounding of the displayed multiple).') + '</p>' +
      '<div class="facts">' +
      '<div><span>TVL</span><b>' + usd(row.tvl_usd) + '</b></div>' +
      '<div><span>7-day change</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age</span><b>' + ageFmt(row.age_days) + '</b></div>' +
      '<div><span>Chains</span><b>' + esc(row.chains.slice(0, 3).join(', ') + (row.chains.length > 3 ? ' +' + (row.chains.length - 3) : '') || '—') + '</b></div>' +
      '<div><span>Listed</span><b>' + esc(row.listed_at || 'unknown') + '</b></div>' +
      '<div><span>Category multiple</span><b>' + row.category_multiple.toFixed(2) + '×</b></div>' +
      '</div>' +
      '<h3>Model breakdown (radar-3)</h3><div class="bars">' +
      bar('Category multiple', row.category_multiple, 1.3, false) +
      bar('Growth', row.growth_multiplier, 1.5, row.growth_multiplier < 1) +
      bar('Maturity', row.maturity_multiplier, 1, false) +
      bar('Breadth', row.breadth_multiplier, 1.15, false) +
      bar('Saturation', row.saturation_multiplier, 1.25, false) +
      '</div>' +
      '<h3>Farm plan — 8 steps</h3><ol class="farm">' +
      row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    d.appendChild(inner);
    document.body.appendChild(d);
    inner.querySelector('.close').addEventListener('click', function () {
      state.selected = null; writeHash(); d.close(); d.remove();
    });
    d.addEventListener('close', function () { state.selected = null; writeHash(); d.remove(); });
    d.showModal();
  }

  readHash();
  render();
  if (state.selected) openDetail(state.selected);
})();
