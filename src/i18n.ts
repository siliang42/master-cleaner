/**
 * Lightweight i18n for Master Cleaner.
 *
 * Language resolution order: explicit flag/env > system locale
 * (Intl / LANG / LC_ALL) > English. Dictionaries are shared with the web UI
 * (web/i18n/<locale>.json) so both surfaces stay in sync.
 *
 * Two translation layers are used:
 *  - `t(key)` for our own UI/CLI strings (explicit keys).
 *  - `localize(text)` for text produced by scan modules (kept in the source
 *    language) so we don't have to thread keys through every module.
 */
import fs from 'fs';
import path from 'path';

export type Locale = 'zh-CN' | 'en';
export const SUPPORTED: Locale[] = ['zh-CN', 'en'];
export const DEFAULT_LOCALE: Locale = 'en';

interface Dict {
  meta?: { locale?: string; name?: string };
  ui?: Record<string, string>;
  cat?: Record<string, string>;
  phrases?: Record<string, string>;
}

let current: Locale = DEFAULT_LOCALE;
let dict: Dict = { ui: {} };
let phraseList: Array<[string, string]> = [];

function dictDir(): string {
  // dist/i18n.js -> ../web/i18n ; also works inside an asar archive.
  return path.join(__dirname, '..', 'web', 'i18n');
}

export function normalizeLocale(input?: string | null): Locale {
  if (!input) return DEFAULT_LOCALE;
  const l = String(input).toLowerCase();
  if (l.startsWith('zh')) return 'zh-CN';
  return 'en';
}

export function isSupported(input?: string | null): boolean {
  return !!input && SUPPORTED.includes(normalizeLocale(input));
}

/** Resolve the active locale, defaulting to the system language. */
export function detectLocale(explicit?: string | null): Locale {
  if (explicit) return normalizeLocale(explicit);
  if (process.env.MC_LANG) return normalizeLocale(process.env.MC_LANG);
  let loc = '';
  try {
    loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    /* ignore */
  }
  if (!loc) loc = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  return normalizeLocale(loc);
}

function readDict(locale: Locale): Dict {
  try {
    return JSON.parse(fs.readFileSync(path.join(dictDir(), `${locale}.json`), 'utf8')) as Dict;
  } catch {
    return { ui: {} };
  }
}

export function setLocale(locale: Locale | string): Locale {
  current = normalizeLocale(locale);
  dict = readDict(current);
  phraseList = Object.entries(dict.phrases || {}).sort((a, b) => b[0].length - a[0].length);
  return current;
}

export function getLocale(): Locale {
  return current;
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = (dict.ui && dict.ui[key]) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export function catLabel(id: string): string {
  return (dict.cat && dict.cat[id]) || id;
}

const PUNCT: Array<[RegExp, string]> = [
  [/，/g, ', '],
  [/。/g, '.'],
  [/：/g, ': '],
  [/（/g, ' ('],
  [/）/g, ') '],
  [/、/g, ', '],
];

/**
 * Translate scan-module output (kept in Chinese in source) to the active
 * locale. Falls back to the original string for anything not covered.
 */
export function localize<T extends string | undefined | null>(text: T): string {
  if (text == null) return '';
  const s = String(text);
  if (current !== 'en') return s;
  if (!/[\u4e00-\u9fff]/.test(s)) return s;
  if (dict.phrases && dict.phrases[s]) return dict.phrases[s];
  let out = s;
  for (const [zh, en] of phraseList) {
    if (out.indexOf(zh) !== -1) out = out.split(zh).join(en);
  }
  for (const [re, rep] of PUNCT) out = out.replace(re, rep);
  return out;
}

// Default to the system language on import unless a caller overrides it.
setLocale(detectLocale());
