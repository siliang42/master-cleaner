import path from 'path';
import os from 'os';
import { isSubPath } from './util';

/**
 * The safety layer is the last line of defense between "a module suggested
 * this" and "we actually touch the disk". It enforces two independent rules:
 *
 *  1. Denylist: certain absolute prefixes must never be removed, regardless of
 *     what a module claims (system roots, kernel extensions, boot files, ...).
 *  2. Allowlist: a path may only be cleaned if it lives inside a trusted root
 *     (the user's home, the OS temp area, or an explicitly opted-in extra root).
 *
 * Anything not cleanable is reported to the user instead of being removed.
 */

const HOME = os.homedir();

function buildDenylist(platform: NodeJS.Platform): string[] {
  const common = ['/'];
  if (platform === 'darwin') {
    return [
      ...common,
      '/System',
      '/usr',
      '/bin',
      '/sbin',
      '/etc',
      '/var',
      '/private/etc',
      '/private/var/db',
      '/private/var/vm',
      '/Library',
      '/Applications',
      '/System/Volumes',
      '/Volumes',
      path.join(HOME, 'Library'), // report-only; modules touch specific subpaths
      path.join(HOME, 'Documents'),
      path.join(HOME, 'Desktop'),
      path.join(HOME, 'Pictures'),
      HOME,
    ];
  }
  if (platform === 'win32') {
    const win = process.env.SystemRoot || 'C:\\Windows';
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return [
      win,
      path.join(win, 'System32'),
      path.join(win, 'SysWOW64'),
      pf,
      pf86,
      process.env.ProgramData || 'C:\\ProgramData',
      'C:\\',
      HOME,
    ];
  }
  return [...common, '/etc', '/usr', '/bin', '/sbin', '/boot', '/lib', '/proc', '/sys', HOME];
}

/**
 * Paths that are *allowed* to be cleaned at all. Modules may only propose items
 * whose paths resolve inside one of these + any user-supplied extra roots.
 */
function buildAllowlist(platform: NodeJS.Platform): string[] {
  const list = [HOME, os.tmpdir()];
  if (platform === 'darwin') {
    list.push('/private/var/folders', '/tmp', '/var/tmp', '/Library/Caches', '/Library/Logs');
  } else if (platform === 'win32') {
    if (process.env.Temp) list.push(process.env.Temp);
    if (process.env.TMP) list.push(process.env.TMP);
    const local = process.env.LOCALAPPDATA;
    if (local) list.push(path.join(local, 'Temp'));
  } else {
    list.push('/tmp', '/var/tmp');
  }
  return list;
}

export class Safety {
  private readonly denylist: string[];
  private readonly allowlist: string[];
  private readonly extraRoots: string[];

  constructor(platform: NodeJS.Platform, extraRoots: string[] = []) {
    this.denylist = buildDenylist(platform).map((p) => path.resolve(p)).filter(Boolean);
    this.allowlist = buildAllowlist(platform).map((p) => path.resolve(p));
    this.extraRoots = extraRoots.map((p) => path.resolve(p));
  }

  /** Returns a human reason if `target` must NOT be removed, else null. */
  whyProtected(target: string): string | null {
    const t = path.resolve(target);
    if (t.length < 4 && process.platform !== 'win32') return '路径过短，疑似根目录';
    for (const d of this.denylist) {
      if (t === d) return `受保护目录本身（${d}）`;
    }
    // Never remove a top-level home entry wholesale (Documents, Downloads root, ...).
    const rel = path.relative(HOME, t);
    if (rel && !rel.startsWith('..') && !rel.includes(path.sep)) {
      return '这是用户主目录下的顶层条目，需手动确认';
    }
    return null;
  }

  isAllowedRoot(target: string): boolean {
    const t = path.resolve(target);
    return [...this.allowlist, ...this.extraRoots].some((r) => isSubPath(r, t));
  }

  /** Full verdict: cleanable only when allowed AND not protected. */
  verdict(target: string): { ok: boolean; reason: string } {
    const prot = this.whyProtected(target);
    if (prot) return { ok: false, reason: prot };
    const roots = [...this.allowlist, ...this.extraRoots];
    const inside = roots.some((r) => isSubPath(r, target));
    if (!inside) return { ok: false, reason: `不在可信根目录内（${target}）` };
    return { ok: true, reason: '' };
  }

  get allowlistRoots(): string[] {
    return [...this.allowlist, ...this.extraRoots];
  }
}
