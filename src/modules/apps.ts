import path from 'path';
import fs from 'fs';
import { mkItem } from './helpers';
import { exists, dirSize, runCmd, formatBytes } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * App uninstall + leftover hunting (borrowed from Lemon 腾讯柠檬 and 360 的
 * "软件卸载/软件搬家"). For macOS we resolve each app's bundle id and then find
 * its caches, preferences, containers and launch agents; the whole set is
 * offered as one recoverable removal. On Windows we enumerate the registry
 * uninstall entries.
 */

const MAX_APPS = 150;
const MIN_APP_BYTES = 10 * 1024 * 1024;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Run `fn` over `items` with a bounded number of concurrent workers. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function appDirs(home: string): string[] {
  const candidates = ['/Applications', path.join(home, 'Applications'), '/Applications/Utilities'];
  return candidates.filter((p) => exists(p));
}

function listApps(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.app'))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

async function bundleId(appPath: string): Promise<string | null> {
  const info = path.join(appPath, 'Contents', 'Info.plist');
  const r = await runCmd('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', info], { timeoutMs: 5000 });
  if (r.ok && r.stdout.trim()) return r.stdout.trim();
  return null;
}

async function leftoversFor(home: string, id: string, name: string): Promise<string[]> {
  const lib = path.join(home, 'Library');
  const exact = [
    path.join(lib, 'Application Support', id),
    path.join(lib, 'Caches', id),
    path.join(lib, 'Containers', id),
    path.join(lib, 'Saved Application State', `${id}.savedState`),
    path.join(lib, 'Logs', id),
    path.join(lib, 'HTTPStorages', id),
    path.join(lib, 'WebKit', id),
    path.join(lib, 'Application Scripts', id),
    path.join(lib, 'Preferences', `${id}.plist`),
  ];
  const found = exact.filter((p) => exists(p));
  // Group Containers are named like "<TEAMID>.<bundle-id>". Match the bundle id
  // directly, or the app name only at a dot boundary, so unrelated containers
  // whose name merely contains the app name are not swept in.
  try {
    const gc = path.join(lib, 'Group Containers');
    const idLower = id.toLowerCase();
    const nameRe = name && name.length >= 4 ? new RegExp(`(^|[.])${escapeRegExp(name.toLowerCase())}([.]|$)`) : null;
    for (const d of fs.readdirSync(gc)) {
      const dl = d.toLowerCase();
      if (dl.includes(idLower) || (nameRe && nameRe.test(dl))) found.push(path.join(gc, d));
    }
  } catch {
    /* ignore */
  }
  return Array.from(new Set(found));
}

async function macScan(ctx: Ctx): Promise<ModuleResult> {
  const notes: string[] = [];
  const errors: string[] = [];
  const apps = appDirs(ctx.home).flatMap(listApps).slice(0, MAX_APPS);

  // A single `du` call gives every app bundle's size cheaply (no per-app walk).
  const sizes = new Map<string, number>();
  if (apps.length) {
    const du = await runCmd('du', ['-sk', ...apps], { timeoutMs: 30000 });
    for (const line of du.stdout.split('\n')) {
      const m = line.match(/^(\d+)\s+(.+)$/);
      if (m) sizes.set(m[2].trim(), parseInt(m[1], 10) * 1024);
    }
  }

  // Resolving bundle ids and measuring leftovers is subprocess/IO heavy, so run
  // a few apps at a time instead of strictly sequentially.
  const scanned = await mapLimit(apps, 6, async (app): Promise<CandidateItem | null> => {
    const name = path.basename(app, '.app');
    const appBytes = sizes.get(app) ?? 0;
    if (appBytes < MIN_APP_BYTES) return null;
    let id: string | null = null;
    try {
      id = await bundleId(app);
    } catch {
      id = null;
    }
    let leftoverBytes = 0;
    const leftovers: string[] = [];
    if (id) {
      try {
        const found = await leftoversFor(ctx.home, id, name);
        for (const p of found) {
          leftovers.push(p);
          try {
            leftoverBytes += (await dirSize(p)).bytes;
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        errors.push(`${name}: ${String(e)}`);
      }
    }
    return mkItem({
      module: 'app-leftovers',
      category: '应用与残留',
      label: `${name}（应用 ${formatBytes(appBytes)}，残留 ${formatBytes(leftoverBytes)}）`,
      detail: [`应用：${app}`, ...leftovers.map((l) => `残留：${l}`)].join('\n'),
      paths: [app, ...leftovers],
      kind: 'group',
      bytes: appBytes + leftoverBytes,
      count: 1 + leftovers.length,
      risk: 'expert',
      defaultSelected: false,
      strategy: 'trash',
      meta: { bundleId: id, appBytes, leftoverBytes },
    });
  });
  const items: CandidateItem[] = scanned.filter((x): x is CandidateItem => x !== null);
  notes.push('卸载会同时移除应用本体与其缓存/偏好设置，全部移入系统回收站可还原。');
  return { module: 'app-leftovers', title: '应用卸载', description: '卸载应用并清除其缓存、偏好设置等残留。', category: 'apps', risk: 'expert', supported: true, items, notes, errors };
}

async function winScan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const keys = [
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const seen = new Set<string>();
  for (const key of keys) {
    const r = await runCmd('reg', ['query', key, '/s'], { timeoutMs: 20000 });
    if (!r.ok) {
      errors.push(`reg ${key}: ${r.stderr.slice(0, 200)}`);
      continue;
    }
    let current: Record<string, string> = {};
    const flush = () => {
      const name = current['DisplayName'];
      if (name && !seen.has(name)) {
        seen.add(name);
        const size = current['EstimatedSize'] ? parseInt(current['EstimatedSize'], 10) * 1024 : 0;
        items.push(
          mkItem({
            module: 'app-leftovers',
            category: '已安装程序',
            label: name,
            detail: [`版本：${current['DisplayVersion'] ?? '-'}`, current['InstallLocation'] ? `位置：${current['InstallLocation']}` : '', current['UninstallString'] ? `卸载命令：${current['UninstallString']}` : ''].filter(Boolean).join('\n'),
            kind: 'info',
            bytes: size,
            risk: 'expert',
            defaultSelected: false,
            strategy: 'info',
            meta: { uninstallString: current['UninstallString'], publisher: current['Publisher'] },
          }),
        );
      }
      current = {};
    };
    for (const line of r.stdout.split('\n')) {
      if (/^HKEY_/.test(line.trim())) {
        flush();
        continue;
      }
      const m = line.match(/^\s+(\S+)\s+REG_\w+\s+(.*)$/);
      if (m) current[m[1]] = m[2].trim();
    }
    flush();
  }
  notes.push('Windows 卸载请在「设置 > 应用」中操作；本列表用于盘点体积与位置。');
  return { module: 'app-leftovers', title: '已安装程序', description: '枚举已安装程序、体积与卸载信息。', category: 'apps', risk: 'expert', supported: true, items, notes, errors };
}

async function scan(ctx: Ctx): Promise<ModuleResult> {
  if (ctx.platform === 'darwin') return macScan(ctx);
  if (ctx.platform === 'win32') return winScan(ctx);
  return { module: 'app-leftovers', title: '应用卸载', description: '仅 macOS / Windows 支持。', category: 'apps', risk: 'expert', supported: false, items: [], notes: ['当前平台不支持应用卸载模块'], errors: [] };
}

export const appsModule: CleanerModule = {
  id: 'app-leftovers',
  title: '应用卸载',
  description: '卸载应用并清理缓存、偏好设置等残留（支持 macOS / Windows）。',
  category: 'apps',
  risk: 'expert',
  platforms: ['darwin', 'win32'],
  defaultEnabled: true,
  scan,
};
