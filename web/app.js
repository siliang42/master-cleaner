'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const T = (k, p) => (window.I18N ? window.I18N.t(k, p) : k);
const L = (s) => (window.I18N ? window.I18N.localize(s) : s);
const CAT = (id) => (window.I18N ? window.I18N.cat(id) : id);

const state = {
  report: null,
  disk: null,
  selected: new Set(),
  sort: { key: 'size', dir: 'desc' },
  scanModules: null,
  scanning: false,
  scanningOnServer: false,
  scanReconnecting: false,
  mode: 'quarantine',
  expert: false,
  filter: null,
  schedules: [],
  vault: [],
  vaultBytesHuman: '',
  view: 'scan',
  legalText: null,
  about: null,
  modules: [],
  itemEls: null,
};

function fmt(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function toast(title, msg, err = false) {
  const el = $('#toast');
  const tEl = $('.toast-title', el);
  const mEl = $('.toast-msg', el);
  if (tEl) tEl.textContent = title;
  if (mEl) { mEl.textContent = msg || ''; mEl.hidden = !msg; }
  el.className = 'toast' + (err ? ' err' : '');
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  const close = $('.toast-close', el);
  if (close) close.onclick = () => { el.hidden = true; };
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 5200);
}

async function api(path, opts) {
  let url = path;
  if (path.indexOf('/api/') === 0) {
    url = path + (path.indexOf('?') === -1 ? '?' : '&') + 'lang=' + encodeURIComponent((window.I18N && window.I18N.locale) || '');
  }
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

/* ---------------- state ---------------- */
async function refreshState() {
  const s = await api('/api/state');
  state.scanningOnServer = !!s.scanning;
  state.schedules = s.schedules;
  state.vault = s.vault.runs;
  state.vaultBytesHuman = s.vault.bytesHuman;
  state.disk = s.disk;
  updateDiskBar();
  const subEl = $('#subtitle');
  if (subEl) subEl.textContent = `${s.os} · ${s.arch}`;
  $('#os-info').textContent = s.os;
  state.modules = s.modules;
  renderCategories(s.modules);
  renderSchedules();
  renderVault(s.vault);
  if (s.legal) {
    state.about = { version: s.version, os: s.os, arch: s.arch, dataDir: s.dataDir, desktop: s.desktop, runtime: s.runtime, legal: s.legal };
    const meta = $('#legal-meta'); if (meta) meta.textContent = `v${s.version || '—'} · ${s.legal.licenseId || 'AGPL-3.0'}`;
  }
}

function renderCategories(modules) {
  const counts = {};
  for (const m of modules) {
    if (!m.supported) continue;
    counts[m.category] = counts[m.category] || { n: 0, bytes: 0, titles: [] };
    counts[m.category].n++;
    counts[m.category].titles.push(m.title);
  }
  if (state.report) {
    for (const mod of state.report.modules) {
      const c = counts[mod.category];
      if (c) c.bytes += mod.items.filter((i) => !i.duplicate && i.strategy !== 'info').reduce((a, i) => a + i.bytes, 0);
    }
  }
  const ul = $('#cat-list');
  ul.innerHTML = '';
  const all = document.createElement('li');
  all.className = state.filter ? '' : 'active';
  all.innerHTML = `<span>${esc(T('cat.allModules'))}</span>`;
  all.onclick = () => { state.filter = null; renderCategories(modules); render(); };
  ul.appendChild(all);
  for (const cat of Object.keys(counts)) {
    const li = document.createElement('li');
    li.className = state.filter === cat ? 'active' : '';
    li.innerHTML = `<span>${esc(CAT(cat))}</span><span class="cat-size">${counts[cat].bytes ? fmt(counts[cat].bytes) : ''}</span>`;
    li.onclick = () => { state.filter = cat; renderCategories(modules); render(); };
    ul.appendChild(li);
  }
}

/* ---------------- disk bar (Lemon-style) ---------------- */
function diskLevel(pct) { return pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : 'ok'; }
function reclaimBytesTotal() {
  return state.report
    ? state.report.modules.flatMap((m) => m.items).filter((i) => !i.duplicate && i.strategy !== 'info').reduce((a, i) => a + i.bytes, 0)
    : 0;
}
function updateDiskBar() {
  const d = state.disk;
  if (!d || !d.total) return;
  const pct = Math.round((d.used / d.total) * 100);
  const rec = reclaimBytesTotal();
  const lbl = $('#disk-label'); if (lbl) lbl.textContent = T('diskUsed', { pct });
  const free = $('#disk-free'); if (free) free.textContent = T('diskFree', { free: d.freeHuman, total: d.totalHuman });
  const usedEl = $('#disk-used');
  if (usedEl) { usedEl.style.width = pct + '%'; usedEl.className = 'lv-' + diskLevel(pct); }
  const dotEl = $('#disk-dot'); if (dotEl) dotEl.className = 'disk-dot lv-' + diskLevel(pct);
  const recPct = d.total ? Math.min(pct, (rec / d.total) * 100) : 0;
  const recEl = $('#disk-reclaim');
  if (recEl) {
    if (recPct > 0.4) { recEl.hidden = false; recEl.style.left = (pct - recPct) + '%'; recEl.style.width = recPct + '%'; }
    else recEl.hidden = true;
  }
  const meterEl = $('#disk-meter'); if (meterEl) meterEl.setAttribute('aria-valuenow', String(pct));
}
function openDiskModal() {
  const m = $('#disk-modal');
  const d = state.disk;
  if (!m || !d || !d.total) return;
  const pct = Math.round((d.used / d.total) * 100);
  const rec = reclaimBytesTotal();
  const big = $('#disk-big-used'); if (big) { big.style.width = pct + '%'; big.className = 'lv-' + diskLevel(pct); }
  const recPct = d.total ? Math.min(pct, (rec / d.total) * 100) : 0;
  const bigRec = $('#disk-big-reclaim');
  if (bigRec) {
    if (recPct > 0.4) { bigRec.hidden = false; bigRec.style.left = (pct - recPct) + '%'; bigRec.style.width = recPct + '%'; }
    else bigRec.hidden = true;
  }
  const lg = $('#disk-legend');
  if (lg) {
    const rows = [
      ['total', T('disk.total'), d.totalHuman, ''],
      ['used', T('disk.used'), d.usedHuman, pct + '%'],
      ['accent', T('disk.reclaim'), rec > 0 ? fmt(rec) : '\u2014', rec > 0 ? ((rec / d.total) * 100).toFixed(1) + '%' : ''],
      ['free', T('disk.free'), d.freeHuman, (100 - pct) + '%'],
    ];
    lg.innerHTML = rows.map(([c, k, v, p]) => `<div class="disk-li ${c}"><span class="dot"></span><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="p">${esc(p)}</span></div>`).join('');
  }
  m.hidden = false;
}
function closeDiskModal() { const m = $('#disk-modal'); if (m) m.hidden = true; }

/* ---------------- scan ---------------- */
function setScanning(on) {
  const btn = $('#btn-scan');
  if (btn) {
    btn.classList.toggle('is-loading', on);
    btn.disabled = on;
    const label = btn.querySelector('span');
    if (label && label.hasAttribute('data-i18n')) label.textContent = on ? T('scan.running') : T('scan');
  }
  if (on) { const bar = $('#result-bar'); if (bar) bar.hidden = true; }
}

function runScan() {
  if (state.scanning) return;
  state.scanning = true;
  setScanning(true);
  const panel = $('#scan-panel');
  const steps = $('#scan-steps');
  const elapsed = $('#scan-elapsed');
  const t0 = Date.now();
  panel.hidden = false;
  steps.innerHTML = '';
  elapsed.textContent = '0.0s';
  clearInterval(runScan._timer);
  runScan._timer = setInterval(() => { elapsed.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
  $('#results').innerHTML = '';
  $('#stats').innerHTML = '';
  const params = new URLSearchParams();
  params.set('lang', (window.I18N && window.I18N.locale) || '');
  if (state.expert) params.set('expert', '1');
  if (state.scanModules) params.set('modules', state.scanModules);
  else if (state.filter) params.set('modules', state.filter);
  const es = new EventSource('/api/scan/stream?' + params.toString());
  const stop = () => { clearInterval(runScan._timer); panel.hidden = true; state.scanning = false; setScanning(false); };
  const addStep = (text) => {
    const prev = steps.lastElementChild;
    if (prev) prev.classList.replace('running', 'done');
    const li = document.createElement('li');
    li.className = 'running';
    li.innerHTML = '<span class="dot"></span><span class="t"></span>';
    $('.t', li).textContent = text;
    steps.appendChild(li);
    steps.scrollTop = steps.scrollHeight;
  };
  es.addEventListener('log', (e) => { addStep(JSON.parse(e.data).message); });
  es.addEventListener('open', () => {
    if (state.scanReconnecting) {
      state.scanReconnecting = false;
      toast(T('toast.scanStart'), T('toast.scanReconnected'));
    }
  });
  es.addEventListener('done', (e) => {
    es.close();
    stop();
    state.scanReconnecting = false;
    state.report = JSON.parse(e.data);
    state.filter = null;
    state.selected = new Set();
    for (const m of state.report.modules) for (const it of m.items) if (it.defaultSelected && it.strategy !== 'info') state.selected.add(it.id);
    refreshState().catch(() => {});
    render();
  });
  es.addEventListener('error', (e) => {
    if (e && typeof e.data === 'string' && e.data) {
      // The server reported a real failure.
      es.close();
      stop();
      state.scanReconnecting = false;
      let message = T('toast.connectionLost');
      try { message = L(JSON.parse(e.data).message); } catch (err) { /* keep fallback */ }
      toast(T('toast.scanError'), message, true);
      return;
    }
    // Transport-level drop: keep the stream open so EventSource reconnects and
    // the server re-attaches us to the scan that is still running.
    if (!state.scanReconnecting) {
      state.scanReconnecting = true;
      toast(T('toast.scanError'), T('toast.scanReconnecting'), true);
    }
  });
}

/** Re-render the last completed scan after a reload (language switch, etc.). */
async function restoreReport() {
  if (state.report) return;
  try {
    const r = await api('/api/report');
    if (!r || !r.report) return;
    state.report = r.report;
    state.filter = null;
    state.selected = new Set();
    for (const m of state.report.modules) for (const it of m.items) if (it.defaultSelected && it.strategy !== 'info') state.selected.add(it.id);
    render();
  } catch (e) { /* first run, no report yet */ }
}

function selectedItems() {
  const all = [];
  if (!state.report) return all;
  for (const m of state.report.modules) for (const it of m.items) all.push(it);
  return all;
}

/* ---------------- render ---------------- */
function render() {
  if (!state.report) return;
  const items = selectedItems();
  const live = items.filter((i) => !i.duplicate);
  const reclaim = live.filter((i) => i.strategy !== 'info').reduce((a, i) => a + i.bytes, 0);
  const reportOnly = live.filter((i) => i.strategy === 'info').reduce((a, i) => a + i.bytes, 0);
  const dupCount = items.length - live.length;
  const selBytes = items.filter((i) => state.selected.has(i.id)).reduce((a, i) => a + i.bytes, 0);
  $('#stats').innerHTML = `
    <div class="stat accent"><div class="k">${esc(T('stat.reclaim'))}</div><div class="v">${fmt(reclaim)}</div></div>
    <div class="stat"><div class="k">${esc(T('stat.selected'))}</div><div class="v" id="stat-selected">${fmt(selBytes)}</div></div>
    <div class="stat"><div class="k">${esc(T('stat.reportOnly'))}</div><div class="v">${fmt(reportOnly)}</div></div>
    <div class="stat" title="${dupCount ? esc(T('dup.title', { n: dupCount })) : ''}"><div class="k">${esc(T('stat.items'))}</div><div class="v">${live.length}</div></div>
    <div class="stat"><div class="k">${esc(T('stat.elapsed'))}</div><div class="v">${((state.report.finishedAt - state.report.startedAt) / 1000).toFixed(1)}s</div></div>`;

  const results = $('#results');
  results.innerHTML = '';
  state.itemEls = new Map();
  const shown = state.report.modules.filter((m) => m.items.length && (!state.filter || m.category === state.filter));
  if (!shown.length) {
    results.innerHTML = `<div class="empty"><h2>${esc(T('empty.noItems.title'))}</h2><p>${esc(T('empty.noItems.body'))}</p></div>`;
  }
  for (const mod of shown) renderModule(mod, results);
  updateActionbar();
  updateSortUI();
  updateDiskBar();
}

function updateSortUI() {
  const bar = $('#result-bar');
  if (bar) bar.hidden = !state.report;
  $$('.sort-btn').forEach((btn) => {
    const on = btn.dataset.key === state.sort.key;
    btn.classList.toggle('active', on);
    const d = $('.dir', btn);
    if (d) d.textContent = on ? (state.sort.dir === 'asc' ? '\u2191' : '\u2193') : '';
    btn.setAttribute('title', T(btn.dataset.key === 'name' ? 'sort.byName' : 'sort.bySize') + ' \u00b7 ' + T(state.sort.dir === 'asc' ? 'sort.asc' : 'sort.desc'));
  });
  const exp = $('#expert-toggle');
  if (exp) {
    const items = selectedItems();
    const canExpert = items.some((i) => i.risk === 'expert' && i.strategy !== 'info' && !i.duplicate);
    exp.hidden = !(canExpert || state.expert);
    const cb = $('#opt-expert');
    if (cb) cb.checked = state.expert;
  }
}

function initSort() {
  $$('.sort-btn').forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.key;
      if (state.sort.key === k) {
        state.sort.dir = state.sort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        state.sort.key = k;
        state.sort.dir = k === 'name' ? 'asc' : 'desc';
      }
      updateSortUI();
      render();
    };
  });
  updateSortUI();
}

/* Sort the items of a module. Default: size, descending. Name uses the file
 * basename when available, falling back to the label. */
function sortItems(items, key, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  const nameOf = (it) => {
    const p = it.path || '';
    const base = p ? p.split(/[\\/]/).filter(Boolean).pop() : '';
    return (base || it.label || '').toString();
  };
  return [...items].sort((a, b) => {
    if (key === 'name') {
      const r = nameOf(a).localeCompare(nameOf(b));
      if (r) return r * mul;
      return b.bytes - a.bytes;
    }
    return (a.bytes - b.bytes) * mul;
  });
}

function renderModule(mod, container) {
  const items = sortItems(mod.items, state.sort.key, state.sort.dir);
  const sum = items.filter((i) => !i.duplicate && i.strategy !== 'info').reduce((a, i) => a + i.bytes, 0);
  const el = document.createElement('div');
  el.className = 'module';
  el.innerHTML = `
    <div class="module-head">
      <svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>
      <span class="title">${esc(L(mod.title))}</span>
      <span class="desc">${esc(L(mod.description))}</span>
      <span class="sum">${fmt(sum)}</span>
    </div>
    <div class="module-body"></div>`;
  const body = $('.module-body', el);
  for (const it of items) body.appendChild(renderItem(it));
  if (mod.notes && mod.notes.length) {
    const n = document.createElement('div');
    n.className = 'notes';
    n.innerHTML = mod.notes.map((t) => `<div>· ${esc(L(t))}</div>`).join('');
    body.appendChild(n);
  }
  $('.module-head', el).onclick = () => el.classList.toggle('collapsed');
  container.appendChild(el);
  return el;
}

function renderItem(it) {
  const row = document.createElement('div');
  const disabled = it.strategy === 'info' || (it.risk === 'expert' && !state.expert);
  row.className = 'item' + (disabled ? ' disabled' : '');
  const badge = it.risk !== 'safe' ? `<span class="badge ${it.risk}">${it.risk === 'caution' ? esc(T('badge.caution')) : esc(T('badge.expert'))}</span>` : `<span class="badge safe">${esc(T('badge.safe'))}</span>`;
  const info = it.strategy === 'info' ? `<span class="badge info">${esc(T('badge.info'))}</span>` : '';
  const dup = it.duplicate ? `<span class="badge dup" title="${esc(T('dup.hint'))}">${esc(T('badge.dup'))}</span>` : '';
  const locked = it.risk === 'expert' && !state.expert && it.strategy !== 'info';
  const unlock = locked ? '<button class="unlock" type="button" title="' + esc(T('expert.unlockTitle')) + '">' + esc(T('expert.unlock')) + '</button>' : '';
  const hasDetail = !!(it.detail || it.path);
  row.innerHTML = `
    <input class="check" type="checkbox" ${state.selected.has(it.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
    <div>
      <div class="label"><span class="name">${esc(L(it.label))}</span>${badge}${info}${dup}${unlock}</div>
      ${hasDetail ? `<button class="detail-toggle">${esc(T('detail.show'))}</button><div class="meta">${esc(L(it.detail || it.path || ''))}</div>` : ''}
    </div>
    <div class="size">${it.bytes ? fmt(it.bytes) : ''}</div>`;
  const cb = $('.check', row);
  cb.onchange = () => {
    if (cb.checked) state.selected.add(it.id); else state.selected.delete(it.id);
    updateActionbar();
  };
  row.dataset.itemId = it.id;
  if (state.itemEls) state.itemEls.set(it.id, row);
  const ub = $('.unlock', row);
  if (ub) ub.onclick = () => enableExpert();
  const dt = $('.detail-toggle', row);
  if (dt) dt.onclick = () => { row.classList.toggle('open'); dt.textContent = row.classList.contains('open') ? T('detail.hide') : T('detail.show'); };
  return row;
}

function updateActionbar() {
  const items = selectedItems();
  const selBytes = items.filter((i) => state.selected.has(i.id)).reduce((a, i) => a + i.bytes, 0);
  $('#sel-count').textContent = T('sel.count', { n: state.selected.size });
  $('#sel-size').textContent = fmt(selBytes);
  const selTile = $('#stat-selected');
  if (selTile) selTile.textContent = fmt(selBytes);
  $('#actionbar').hidden = !state.report || state.selected.size === 0;
  renderSelection();
}
/* ---------------- selection review: what will actually be cleaned ---------------- */
function selItems() {
  return selectedItems().filter((i) => state.selected.has(i.id));
}

function moduleTitleOf(id) {
  const mods = (state.report && state.report.modules) || [];
  const m = mods.find((x) => x.module === id || x.id === id);
  return m ? L(m.title) : id;
}

function renderSelection() {
  const box = $('#selection');
  if (!box) return;
  const show = state.view === 'scan' && !!state.report && state.selected.size > 0;
  box.hidden = !show;
  if (!show) { box.innerHTML = ''; return; }

  const items = selItems().slice().sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  const total = items.reduce((a, i) => a + (i.bytes || 0), 0);
  const risky = items.filter((i) => i.risk !== 'safe').length;
  const modeKey = state.mode === 'trash' ? 'seg.trash' : state.mode === 'delete' ? 'seg.delete' : 'seg.quarantine';

  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.module)) groups.set(it.module, []);
    groups.get(it.module).push(it);
  }

  let html = `<div class="sel-head">
      <span class="sel-title">${esc(T('sel.heading'))}</span>
      <span class="sel-sum">${esc(T('sel.summary', { n: items.length, bytes: fmt(total) }))}</span>
      <span class="grow"></span>
      <span class="sel-mode">${esc(T(modeKey))}</span>
      <button class="linkish" type="button" data-sel-act="clear">${esc(T('sel.clear'))}</button>
    </div>
    <div class="sel-body">`;
  for (const [mod, list] of groups) {
    html += `<div class="sel-group">${esc(moduleTitleOf(mod))}</div>`;
    for (const it of list) {
      html += `<div class="sel-row" data-item-id="${esc(it.id)}" title="${esc(T('sel.locate'))}">
        <span class="sel-dot ${esc(it.risk)}"></span>
        <span class="sel-name">${esc(L(it.label))}</span>
        <span class="sel-cat">${esc(L(it.category))}</span>
        <span class="sel-size">${it.bytes ? fmt(it.bytes) : ''}</span>
        <button class="sel-x" type="button" data-remove="${esc(it.id)}" title="${esc(T('sel.deselect'))}" aria-label="${esc(T('sel.deselect'))}">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
        </button>
      </div>`;
    }
  }
  html += '</div>';
  if (risky) html += `<div class="sel-warn">${esc(T('sel.warn', { n: risky }))}</div>`;
  box.innerHTML = html;
}

function syncCheckboxes() {
  if (!state.itemEls) return;
  for (const [id, el] of state.itemEls) {
    const cb = $('.check', el);
    if (cb) cb.checked = state.selected.has(id);
  }
}

function deselectById(id) {
  state.selected.delete(id);
  const el = state.itemEls && state.itemEls.get(id);
  const cb = el && $('.check', el);
  if (cb) cb.checked = false;
  updateActionbar();
}

function clearSelection() {
  state.selected = new Set();
  syncCheckboxes();
  updateActionbar();
}

/* Expert items are never pre-selected; this unlocks them for deliberate manual
 * selection without a re-scan (the report already contains them). */
function enableExpert() {
  state.expert = true;
  const cb = $('#opt-expert');
  if (cb) cb.checked = true;
  render();
}

function locateItem(id) {
  let el = state.itemEls && state.itemEls.get(id);
  if (!el && state.filter) {
    state.filter = null;
    if (state.modules && state.modules.length) renderCategories(state.modules);
    render();
    el = state.itemEls && state.itemEls.get(id);
  }
  if (!el) return;
  const mod = el.closest('.module');
  if (mod) mod.classList.remove('collapsed');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}


/* ---------------- clean ---------------- */
async function doClean() {
  const ids = Array.from(state.selected);
  if (!ids.length) return;
  const btn = $('#btn-clean');
  btn.disabled = true;
  btn.classList.add('is-loading');
  const lbl = btn.querySelector('span');
  if (lbl) lbl.textContent = T('clean.cleaning');
  $$('.seg[data-mode]').forEach((s) => (s.disabled = true));
  const scanBtn = $('#btn-scan'); if (scanBtn) scanBtn.disabled = true;
  try {
    const res = await api('/api/clean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, mode: state.mode }) });
    toast(T('toast.cleanDone'), T('clean.done.body', { bytes: res.recordHuman.bytes, n: res.record.removed, vaultNote: state.mode === 'quarantine' ? T('clean.vaultNote') : '' }));
    if (res.skipped && res.skipped.length) toast(T('toast.skipped'), T('clean.skipped.body', { n: res.skipped.length }), false);
    state.selected = new Set();
    runScan();
  } catch (e) {
    toast(T('toast.cleanFailed'), String(e), true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    const l2 = btn.querySelector('span'); if (l2) l2.textContent = T('clean.selected');
    $$('.seg[data-mode]').forEach((s) => (s.disabled = false));
    const sb = $('#btn-scan'); if (sb) sb.disabled = state.scanning;
    updateActionbar();
  }
}

/* ---------------- schedules ---------------- */
function renderSchedules() {
  const box = $('#sched-list');
  box.innerHTML = '';
  if (!state.schedules.length) {
    box.innerHTML = `<div class="muted">${esc(T('sched.empty'))}</div>`;
    return;
  }
  for (const s of state.schedules) {
    const row = document.createElement('div');
    row.className = 'list-row';
    const next = s.nextRun ? new Date(s.nextRun).toLocaleString() : '—';
    row.innerHTML = `
      <div class="grow">
        <div class="name">${esc(s.name)}</div>
        <div class="muted small">cron ${esc(s.cron)} · ${esc(s.description || '')} · ${esc(T('sched.modules'))} ${s.moduleIds.join(', ')} · ${esc(s.mode)}</div>
        <div class="muted small">${esc(T('sched.next'))} ${next}${s.lastRunAt ? ` · ${esc(T('sched.last'))} ${new Date(s.lastRunAt).toLocaleString()} (${fmt(s.lastResult?.bytes || 0)})` : ''}</div>
      </div>
      <button class="btn btn-ghost" data-act="toggle">${esc(s.enabled ? T('sched.toggle.disable') : T('sched.toggle.enable'))}</button>
      <button class="btn btn-ghost" data-act="remove">${esc(T('sched.remove'))}</button>`;
    row.querySelector('[data-act="toggle"]').onclick = async () => { await api(`/api/schedules/${s.id}/${s.enabled ? 'disable' : 'enable'}`, { method: 'POST' }); refreshState(); };
    row.querySelector('[data-act="remove"]').onclick = async () => { await api(`/api/schedules/${s.id}`, { method: 'DELETE' }); refreshState(); };
    box.appendChild(row);
  }
}

function renderSchedModuleChips() {
  const box = $('#sched-modules');
  if (!state.report) return;
  const mods = state.report.modules.filter((m) => m.supported);
  box.innerHTML = '';
  for (const m of mods) {
    const on = ['ai-residue', 'dev-caches', 'system-junk'].includes(m.id);
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip' + (on ? ' on' : '');
    c.textContent = L(m.title);
    c.dataset.id = m.id;
    c.onclick = () => c.classList.toggle('on');
    box.appendChild(c);
  }
}

/* ---------------- vault ---------------- */
function renderVault(v) {
  const box = $('#vault-list');
  const runs = v.runs || state.vault || [];
  const stats = $('#vault-stats');
  if (stats) {
    stats.innerHTML = runs.length
      ? `<span class="vault-usage">${esc(T('vault.usage', { bytes: v.bytesHuman || state.vaultBytesHuman || '0 B', runs: runs.length }))}</span><span class="muted small">${esc(T('vault.hint'))}</span>`
      : '';
  }
  if (!runs.length) {
    box.innerHTML = `<div class="muted">${esc(T('vault.empty'))}</div>`;
    return;
  }
  box.innerHTML = '';
  for (const r of runs) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="grow">
        <div class="name">${esc(r.id)} · ${esc(r.mode)}</div>
        <div class="muted small">${esc(T('sel.count', { n: r.entries.length }))} · ${fmt(r.bytes)} · ${new Date(r.at).toLocaleString()}</div>
      </div>
      <button class="btn">${esc(T('vault.restore'))}</button>`;
    row.querySelector('button').onclick = async () => {
      const res = await api('/api/vault/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }) });
      toast(T('toast.restored'), T('vault.restored.body', { n: res.restored }));
      refreshState();
    };
    box.appendChild(row);
  }
}

/* ---------------- about / legal ---------------- */
async function ensureLegalText() {
  if (state.legalText != null) return state.legalText;
  try {
    const r = await api('/api/legal');
    state.legalText = r && r.text ? r.text : '';
  } catch (e) {
    state.legalText = '';
  }
  return state.legalText;
}

function aboutRow(label, value) {
  const v = value == null || value === '' ? '\u2014' : value;
  return `<div class="about-row"><span class="k">${esc(label)}</span><span class="v">${esc(v)}</span></div>`;
}

function renderAbout() {
  const box = $('#about-body');
  if (!box) return;
  const a = state.about || {};
  const lg = a.legal || {};
  const rt = a.runtime || {};
  const runtime = [rt.electron ? `Electron ${rt.electron}` : null, rt.chrome ? `Chromium ${rt.chrome}` : null, rt.node ? `Node ${rt.node}` : null].filter(Boolean).join(' \u00b7 ');
  const links = [];
  if (lg.projectUrl) links.push(`<a class="linkish" href="${esc(lg.projectUrl)}" target="_blank" rel="noreferrer">${esc(T('about.home'))}</a>`);
  if (lg.contactEmail) links.push(`<a class="linkish" href="mailto:${esc(lg.contactEmail)}">${esc(T('about.contact'))}</a>`);
  box.innerHTML = `
    <div class="about-hero">
      <span class="brand-mark" aria-hidden="true"></span>
      <div>
        <div class="about-title">${esc(lg.productName || 'Master Cleaner')}</div>
        <div class="muted small">v${esc(a.version || lg.version || '\u2014')} \u00b7 ${esc(lg.licenseId || 'AGPL-3.0-only')}${a.desktop ? ' \u00b7 ' + esc(T('about.desktop')) : ''}</div>
      </div>
    </div>
    <div class="about-grid">
      ${aboutRow(T('about.license'), `${lg.licenseName || 'GNU Affero General Public License v3.0'} (${lg.licenseId || 'AGPL-3.0-only'})`)}
      ${aboutRow(T('about.copyright'), lg.copyright || '')}
      ${aboutRow(T('about.attribution'), lg.attributionNotice || '')}
      ${aboutRow(T('about.oslabel'), [a.os, a.arch].filter(Boolean).join(' \u00b7 '))}
      ${aboutRow(T('about.runtime'), runtime)}
      ${aboutRow(T('about.dataDir'), a.dataDir || '')}
    </div>
    <div class="about-section">
      <div class="about-h">${esc(T('about.disclaimer'))}</div>
      <ul class="about-list">${(lg.disclaimer || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <p class="muted small">${esc(T('about.accept'))}</p>
    </div>
    <div class="about-section">
      <details>
        <summary>${esc(T('about.viewFull'))}</summary>
        <pre id="about-legal-text" class="legal-text"></pre>
      </details>
    </div>
    <div class="about-foot">${links.join('')}</div>
  `;
}

async function openAbout() {
  const modal = $('#about-modal');
  if (!modal) return;
  renderAbout();
  modal.hidden = false;
  await ensureLegalText();
  const pre = $('#about-legal-text');
  if (pre) pre.textContent = state.legalText || T('about.noText');
}
function closeAbout() { const m = $('#about-modal'); if (m) m.hidden = true; }

/* ---------------- settings ---------------- */
function currentLangChoice() { try { return localStorage.getItem('mc-lang') || ''; } catch (e) { return ''; } }
function openSettings() {
  const m = $('#settings-modal');
  if (!m) return;
  const cur = currentLangChoice();
  $$('#lang-seg .seg').forEach((b) => b.classList.toggle('active', (b.dataset.lang || '') === cur));
  m.hidden = false;
}
function closeSettings() { const m = $('#settings-modal'); if (m) m.hidden = true; }
function setLanguage(v) {
  try { if (v) localStorage.setItem('mc-lang', v); else localStorage.removeItem('mc-lang'); } catch (e) { /* ignore */ }
  location.reload();
}
window.openSettings = openSettings;

/* ---------------- wiring ---------------- */
function setView(v) {
  state.view = v;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach((el) => (el.hidden = el.id !== 'view-' + v));
  $('#actionbar').hidden = v !== 'scan' || !state.report || state.selected.size === 0;
  renderSelection();
  if (v === 'schedule') renderSchedModuleChips();
}

function init() {
  $('#btn-scan').onclick = runScan;
  $('#btn-clean').onclick = doClean;
  const langBtn = $('#btn-lang');
  if (langBtn) {
    const target = (window.I18N && window.I18N.locale) === 'en' ? 'zh-CN' : 'en';
    const lbl = $('#btn-lang-label');
    if (lbl) lbl.textContent = target === 'en' ? 'EN' : '中';
    langBtn.title = target === 'en' ? 'English' : '简体中文';
    langBtn.setAttribute('aria-label', target === 'en' ? 'Switch to English' : '切换到中文');
    langBtn.hidden = false;
    langBtn.onclick = () => setLanguage(target);
  }
  const selBox = $('#selection');
  if (selBox) {
    selBox.onclick = (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) { deselectById(rm.getAttribute('data-remove')); return; }
      if (e.target.closest('[data-sel-act="clear"]')) { clearSelection(); return; }
      const row = e.target.closest('.sel-row');
      if (row && row.dataset.itemId) locateItem(row.dataset.itemId);
    };
  }

  $('#opt-expert').onchange = (e) => { state.expert = e.target.checked; if (state.report) render(); };
  $$('.tab').forEach((t) => (t.onclick = () => setView(t.dataset.view)));
  $$('.seg[data-mode]').forEach((s) => (s.onclick = () => { state.mode = s.dataset.mode; $$('.seg[data-mode]').forEach((x) => x.classList.toggle('active', x === s)); }));
  initSort();
  $('#sched-preset').onchange = (e) => { $('#sched-cron-field').hidden = e.target.value !== 'custom'; };
  $('#sched-form').onsubmit = async (e) => {
    e.preventDefault();
    const preset = $('#sched-preset').value;
    const cron = preset === 'custom' ? $('#sched-cron').value.trim() : preset;
    const moduleIds = $$('#sched-modules .chip.on').map((c) => c.dataset.id);
    try {
      await api('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('#sched-name').value, cron, moduleIds, mode: $('#sched-mode').value }) });
      toast(T('toast.schedCreated'), cron);
      refreshState();
    } catch (err) {
      toast(T('toast.schedFailed'), String(err), true);
    }
  };
  $('#btn-purge').onclick = async () => {
    const res = await api('/api/vault/purge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ olderThan: 30 }) });
    if (res.count) toast(T('toast.vaultPurged'), T('purged.body', { n: res.count, bytes: res.bytesHuman }));
    else toast(T('toast.vaultPurgeNone'), T('purged.none', { days: 30 }));
    refreshState();
  };
  const aboutBtn = $('#btn-about');
  if (aboutBtn) {
    aboutBtn.onclick = openAbout;
    $('#about-close').onclick = closeAbout;
    $('#about-modal').addEventListener('click', (e) => { if (e.target.id === 'about-modal') closeAbout(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAbout(); });
  }
  const meterEl = $('#disk-meter');
  if (meterEl) {
    meterEl.addEventListener('click', openDiskModal);
    meterEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDiskModal(); } });
  }
  const diskCloseBtn = $('#disk-close');
  if (diskCloseBtn) diskCloseBtn.onclick = closeDiskModal;
  const diskModalEl = $('#disk-modal');
  if (diskModalEl) diskModalEl.addEventListener('click', (e) => { if (e.target.id === 'disk-modal') closeDiskModal(); });
  const viewLargeBtn = $('#disk-view-large');
  if (viewLargeBtn) viewLargeBtn.onclick = () => { closeDiskModal(); state.filter = 'largefiles'; refreshState().catch(() => {}); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDiskModal(); });
  const settingsBtn = $('#btn-settings');
  if (settingsBtn) settingsBtn.onclick = openSettings;
  const settingsCloseBtn = $('#settings-close');
  if (settingsCloseBtn) settingsCloseBtn.onclick = closeSettings;
  const settingsModalEl = $('#settings-modal');
  if (settingsModalEl) settingsModalEl.addEventListener('click', (e) => { if (e.target.id === 'settings-modal') closeSettings(); });
  $$('#lang-seg .seg').forEach((b) => (b.onclick = () => setLanguage(b.dataset.lang || '')));
  const kbd = $('#settings-kbd');
  if (kbd) kbd.textContent = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '\u2318,' : 'Ctrl+,';
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
  refreshState()
    .then(() => {
      if (state.scanningOnServer) runScan();
      else void restoreReport();
    })
    .catch((e) => toast(T('toast.backend'), String(e), true));
  const qs = new URLSearchParams(location.search);
  const sk = qs.get('sort');
  if (sk === 'size' || sk === 'name') state.sort.key = sk;
  const sd = qs.get('dir');
  if (sd === 'asc' || sd === 'desc') state.sort.dir = sd;
  const sm = qs.get('modules');
  if (sm) state.scanModules = sm;
  updateSortUI();
  if (qs.get('auto') === '1') setTimeout(runScan, 300);
}

// Entry points used by the Electron tray shortcuts (see electron/main.js).
window.MC_API = { runScan: () => runScan(), showView: (v) => setView(v) };

if (window.I18N && window.I18N.ready) window.I18N.ready.then(init); else init();
