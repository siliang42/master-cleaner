'use strict';

/**
 * Front-end i18n. Mirrors src/i18n.ts.
 *
 * Default language follows the system: the client asks the backend which locale
 * it resolved (so UI and scan-module text always agree) and falls back to
 * navigator.language. An explicit choice via localStorage 'mc-lang' wins, and is
 * also forwarded to the backend on every /api call.
 */
(function () {
  const SUPPORTED = ['zh-CN', 'en'];
  const DEFAULT = 'en';

  function normalize(loc) {
    if (!loc) return DEFAULT;
    const l = String(loc).toLowerCase();
    if (l.startsWith('zh')) return 'zh-CN';
    return 'en';
  }
  function saved() {
    try { return localStorage.getItem('mc-lang') || ''; } catch (e) { return ''; }
  }
  async function resolveLocale() {
    const s = saved();
    if (s) return normalize(s);
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.ok) {
        const st = await r.json();
        if (st && st.locale) return normalize(st.locale);
      }
    } catch (e) { /* offline / first paint */ }
    const nav = navigator.language || (navigator.languages && navigator.languages[0]) || '';
    return normalize(nav);
  }

  let locale = normalize(saved() || navigator.language || '');
  let dict = { ui: {}, cat: {}, phrases: {} };
  let phraseList = [];

  function buildPhrases() {
    phraseList = Object.entries(dict.phrases || {}).sort((a, b) => b[0].length - a[0].length);
  }
  function t(key, params) {
    let s = dict.ui && dict.ui[key] != null ? dict.ui[key] : key;
    if (params) for (const k of Object.keys(params)) s = s.split('{' + k + '}').join(String(params[k]));
    return s;
  }
  function cat(id) { return (dict.cat && dict.cat[id]) || id; }

  const PUNCT = [[/，/g, ', '], [/。/g, '.'], [/：/g, ': '], [/（/g, ' ('], [/）/g, ') '], [/、/g, ', ']];
  function localize(text) {
    if (text == null) return '';
    const s = String(text);
    if (locale !== 'en') return s;
    if (!/[\u4e00-\u9fff]/.test(s)) return s;
    if (dict.phrases && dict.phrases[s]) return dict.phrases[s];
    let out = s;
    for (const [zh, en] of phraseList) if (out.indexOf(zh) !== -1) out = out.split(zh).join(en);
    for (const [re, rep] of PUNCT) out = out.replace(re, rep);
    return out;
  }

  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    root.querySelectorAll('[data-i18n-value]').forEach((el) => { el.value = t(el.getAttribute('data-i18n-value')); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    document.documentElement.lang = locale;
    document.title = t('appTitle');
  }

  async function load(loc) {
    locale = normalize(loc || locale);
    try {
      const r = await fetch('/i18n/' + locale + '.json', { cache: 'no-store' });
      if (r.ok) dict = await r.json();
    } catch (e) { /* keep defaults */ }
    buildPhrases();
    apply();
    return locale;
  }

  window.I18N = {
    t, cat, localize, apply, load,
    get locale() { return locale; },
    supported: SUPPORTED,
    setLocale: (l) => load(l),
    ready: null,
  };
  window.I18N.ready = (async () => {
    locale = await resolveLocale();
    return load(locale);
  })();
})();
