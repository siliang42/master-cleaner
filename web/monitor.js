'use strict';
/* System monitor widget: CPU / memory / disk / temperature cards (Lemon-style). */
(function () {
  const T = (k, p) => (window.I18N ? window.I18N.t(k, p) : k);
  const REFRESH = 3000;
  const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    cpu: '<svg viewBox="0 0 24 24" ' + S + '><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
    memory: '<svg viewBox="0 0 24 24" ' + S + '><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 17v3M12 17v3M17 17v3"/></svg>',
    disk: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
    temp: '<svg viewBox="0 0 24 24" ' + S + '><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/></svg>',
  };

  function bytes(n) {
    if (n == null) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function level(p) { return p >= 90 ? 'lv-crit' : p >= 75 ? 'lv-warn' : ''; }

  function card(kind, label, value, sub, pct, cls) {
    const bar = pct == null ? '' : '<div class="mon-bar"><span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div>';
    return '<div class="mon-card ' + (cls || '') + '">' +
      '<span class="mon-ico">' + ICONS[kind] + '</span>' +
      '<div class="mon-body"><div class="mon-k">' + label + '</div>' +
      '<div class="mon-v">' + value + '</div>' +
      (sub ? '<div class="mon-sub">' + sub + '</div>' : '') + bar + '</div></div>';
  }

  function render(el, d) {
    const cpu = Math.round(d.cpu || 0);
    const mem = d.memory || {};
    const disk = d.disk || {};
    const t = d.temperature || {};

    const memPct = Math.round(mem.percent || 0);
    const diskPct = Math.round(disk.percent || 0);

    let tempValue = '—', tempSub = T('monitor.tempHint'), tempPct = null, tempCls = '';
    if (t.celsius != null) {
      tempValue = t.celsius.toFixed(1) + ' °C';
      tempSub = (t.source || '').toUpperCase();
      tempPct = Math.max(0, Math.min(100, ((t.celsius - 30) / 60) * 100));
      tempCls = level(tempPct);
    } else if (t.speedLimit != null && t.speedLimit < 100) {
      tempValue = t.speedLimit + '%';
      tempSub = T('monitor.thermal');
      tempPct = t.speedLimit;
      tempCls = level(100 - t.speedLimit);
    }

    el.innerHTML =
      card('cpu', T('monitor.cpu'), cpu + '%', '', cpu, level(cpu)) +
      card('memory', T('monitor.memory'), memPct + '%', T('monitor.usedOf', { used: bytes(mem.used), total: bytes(mem.total) }), memPct, level(memPct)) +
      card('disk', T('monitor.disk'), diskPct + '%', T('monitor.usedOf', { used: bytes(disk.used), total: bytes(disk.total) }), diskPct, level(diskPct)) +
      card('temp', T('monitor.temp'), tempValue, tempSub, tempPct, tempCls);
    el.hidden = false;
  }

  async function tick() {
    const el = document.getElementById('sysmon');
    if (!el) return;
    try {
      const lang = encodeURIComponent((window.I18N && window.I18N.locale) || '');
      const r = await fetch('/api/metrics?lang=' + lang, { cache: 'no-store' });
      if (!r.ok) return;
      render(el, await r.json());
    } catch (e) { /* offline */ }
  }

  function start() {
    void tick();
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) void tick(); }, REFRESH);
  }

  const ready = window.I18N && window.I18N.ready ? window.I18N.ready : Promise.resolve();
  ready.then(start).catch(start);
  window.addEventListener('focus', () => void tick());
})();
