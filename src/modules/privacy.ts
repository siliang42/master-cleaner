import path from 'path';
import fs from 'fs';
import { mkItem, sumSizes } from './helpers';
import { exists, dirSize } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * Browser caches and privacy data. Caches are safe and pre-selected; history,
 * cookies and logins are surfaced as `caution`/report-only because clearing
 * them logs the user out everywhere.
 */

const CHROMIUM_CACHE_SUBS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'CachedData',
  'DawnCache',
  'DawnGraphiteCache',
  'GrShaderCache',
  'ShaderCache',
  'Media Cache',
  'Service Worker/CacheStorage',
  'Service Worker/ScriptCache',
];
const CHROMIUM_DATA_SUBS = ['History', 'Top Sites', 'Visited Links', 'Web Data', 'Cookies', 'Network/Cookies', 'Login Data', 'Favicons', 'Shortcuts'];

interface Browser {
  name: string;
  /** Profile root directories that contain a `Default`/`Profile N` folder. */
  roots: string[];
  kind: 'chromium' | 'firefox' | 'safari';
}

function browsers(ctx: Ctx): Browser[] {
  const h = ctx.home;
  const L = path.join(h, 'Library');
  const AS = path.join(L, 'Application Support');
  const LocalCaches = path.join(L, 'Caches');
  if (ctx.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(h, 'AppData', 'Roaming');
    return [
      { name: 'Google Chrome', roots: [path.join(local, 'Google', 'Chrome', 'User Data')], kind: 'chromium' },
      { name: 'Microsoft Edge', roots: [path.join(local, 'Microsoft', 'Edge', 'User Data')], kind: 'chromium' },
      { name: 'Brave', roots: [path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')], kind: 'chromium' },
      { name: 'Vivaldi', roots: [path.join(local, 'Vivaldi', 'User Data')], kind: 'chromium' },
      { name: '360 浏览器', roots: [path.join(local, '360Chrome', 'Chrome', 'User Data'), path.join(roaming, '360se6', 'User Data')], kind: 'chromium' },
      { name: 'QQ 浏览器', roots: [path.join(local, 'Tencent', 'QQBrowser', 'User Data')], kind: 'chromium' },
      { name: 'Firefox', roots: [path.join(roaming, 'Mozilla', 'Firefox')], kind: 'firefox' },
    ];
  }
  return [
    { name: 'Google Chrome', roots: [path.join(AS, 'Google', 'Chrome')], kind: 'chromium' },
    { name: 'Chrome Canary', roots: [path.join(AS, 'Google', 'Chrome Canary')], kind: 'chromium' },
    { name: 'Microsoft Edge', roots: [path.join(AS, 'Microsoft Edge')], kind: 'chromium' },
    { name: 'Brave', roots: [path.join(AS, 'BraveSoftware', 'Brave-Browser')], kind: 'chromium' },
    { name: 'Vivaldi', roots: [path.join(AS, 'Vivaldi')], kind: 'chromium' },
    { name: 'Arc', roots: [path.join(AS, 'Arc')], kind: 'chromium' },
    { name: 'Firefox', roots: [path.join(AS, 'Firefox')], kind: 'firefox' },
    { name: 'Safari', roots: [path.join(LocalCaches, 'com.apple.Safari')], kind: 'safari' },
  ];
}

function chromiumProfiles(root: string): string[] {
  const out: string[] = [];
  for (const name of ['Default', 'Guest Profile', 'System Profile']) {
    const p = path.join(root, name);
    if (exists(p)) out.push(p);
  }
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory() && /^Profile \d+$/.test(e.name)) out.push(path.join(root, e.name));
  }
  return out;
}

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];

  for (const b of browsers(ctx)) {
    if (!b.roots.some((r) => exists(r))) continue;
    if (b.kind === 'chromium') {
      const profiles = b.roots.flatMap((r) => chromiumProfiles(r));
      const cachePaths: string[] = [];
      const dataPaths: string[] = [];
      for (const prof of profiles) {
        for (const sub of CHROMIUM_CACHE_SUBS) {
          const p = path.join(prof, sub);
          if (exists(p)) cachePaths.push(p);
        }
        for (const sub of CHROMIUM_DATA_SUBS) {
          const p = path.join(prof, sub);
          if (exists(p)) dataPaths.push(p);
        }
      }
      if (cachePaths.length) {
        const s = await sumSizes(cachePaths);
        if (s.bytes > 0)
          items.push(mkItem({ module: 'browser-privacy', category: `浏览器缓存 · ${b.name}`, label: `${b.name} 缓存`, paths: cachePaths, kind: 'group', bytes: s.bytes, count: cachePaths.length, risk: 'safe', defaultSelected: true, strategy: 'quarantine', detail: '浏览器可自动重建的页面/代码/GPU 缓存' }));
      }
      if (dataPaths.length) {
        const s = await sumSizes(dataPaths);
        if (s.bytes > 0)
          items.push(mkItem({ module: 'browser-privacy', category: `浏览记录与隐私 · ${b.name}`, label: `${b.name} 历史/ Cookie / 登录数据`, paths: dataPaths, kind: 'group', bytes: s.bytes, count: dataPaths.length, risk: 'caution', defaultSelected: false, strategy: 'quarantine', detail: '清除后浏览历史与网站登录状态会丢失，需重新登录' }));
      }
    } else if (b.kind === 'firefox') {
      const root = b.roots[0];
      let profiles: string[] = [];
      try {
        profiles = fs.readdirSync(path.join(root, 'Profiles'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(root, 'Profiles', e.name));
      } catch {
        profiles = [];
      }
      const cachePaths: string[] = [];
      const dataPaths: string[] = [];
      for (const prof of profiles) {
        for (const sub of ['cache2', 'startupCache', 'shader-cache', 'jumpListCache']) {
          const p = path.join(prof, sub);
          if (exists(p)) cachePaths.push(p);
        }
        for (const sub of ['places.sqlite', 'cookies.sqlite', 'formhistory.sqlite', 'logins.json']) {
          const p = path.join(prof, sub);
          if (exists(p)) dataPaths.push(p);
        }
      }
      if (ctx.platform === 'darwin') {
        const fc = path.join(ctx.home, 'Library', 'Caches', 'Firefox');
        if (exists(fc)) cachePaths.push(fc);
      }
      if (cachePaths.length) {
        const s = await sumSizes(cachePaths);
        if (s.bytes > 0)
          items.push(mkItem({ module: 'browser-privacy', category: `浏览器缓存 · ${b.name}`, label: `${b.name} 缓存`, paths: cachePaths, kind: 'group', bytes: s.bytes, count: cachePaths.length, risk: 'safe', defaultSelected: true, strategy: 'quarantine' }));
      }
      if (dataPaths.length) {
        const s = await sumSizes(dataPaths);
        if (s.bytes > 0)
          items.push(mkItem({ module: 'browser-privacy', category: `浏览记录与隐私 · ${b.name}`, label: `${b.name} 历史 / Cookie / 登录`, paths: dataPaths, kind: 'group', bytes: s.bytes, count: dataPaths.length, risk: 'caution', defaultSelected: false, strategy: 'quarantine', detail: '清除后会丢失浏览历史与登录状态' }));
      }
    } else {
      // Safari caches
      const base = b.roots[0];
      const paths: string[] = [];
      for (const sub of ['', 'WebKitCache', 'WebKit', 'fsCachedData']) {
        const p = path.join(base, sub);
        if (sub === '' && exists(base)) paths.push(base);
        else if (exists(p)) paths.push(p);
      }
      const s = await sumSizes(paths);
      if (s.bytes > 0)
        items.push(mkItem({ module: 'browser-privacy', category: '浏览器缓存 · Safari', label: 'Safari 缓存', paths, kind: 'group', bytes: s.bytes, count: paths.length, risk: 'safe', defaultSelected: true, strategy: 'quarantine' }));
    }
  }

  // macOS shared privacy files.
  if (ctx.platform === 'darwin') {
    const shared = path.join(ctx.home, 'Library', 'Application Support', 'com.apple.sharedfilelist');
    if (exists(shared)) {
      const s = await sumSizes([shared]);
      if (s.bytes > 0)
        items.push(mkItem({ module: 'browser-privacy', category: '系统隐私', label: '最近使用列表 (SharedFileList)', path: shared, bytes: s.bytes, count: s.count, risk: 'caution', defaultSelected: false, strategy: 'quarantine', detail: '「最近打开」菜单记录' }));
    }
  }

  notes.push('浏览器历史 / Cookie / 登录数据默认不勾选，勾选并清理后会退出所有网站登录。');
  return { module: 'browser-privacy', title: '浏览器与隐私', description: 'Chrome/Edge/Safari/Firefox 等浏览器缓存与浏览记录、Cookie。', category: 'privacy', risk: 'caution', supported: true, items, notes, errors };
}

export const privacyModule: CleanerModule = {
  id: 'browser-privacy',
  title: '浏览器与隐私',
  description: '浏览器缓存与隐私数据，多浏览器支持。',
  category: 'privacy',
  risk: 'caution',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan,
};
