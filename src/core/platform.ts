import os from 'os';
import path from 'path';
import fs from 'fs';

export interface DiskUsage {
  path: string;
  total: number;
  free: number;
  used: number;
}

export function diskUsage(target = os.homedir()): DiskUsage {
  try {
    const s = (fs as unknown as { statfsSync: (p: string) => { blocks: number; bsize: number; bfree: number; bavail: number } }).statfsSync(target);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { path: target, total, free, used: total - free };
  } catch {
    return { path: target, total: 0, free: 0, used: 0 };
  }
}

export function osLabel(): string {
  const p = process.platform;
  if (p === 'darwin') return `macOS ${os.release()}`;
  if (p === 'win32') return `Windows ${os.release()}`;
  return `${os.type()} ${os.release()}`;
}

/** Common cache/config roots for the current user, per platform. */
export function userCacheRoots(): string[] {
  const home = os.homedir();
  const out: string[] = [];
  if (process.platform === 'darwin') {
    out.push(
      path.join(home, 'Library', 'Caches'),
      path.join(home, 'Library', 'Logs'),
      path.join(home, 'Library', 'Application Support'),
      path.join(home, 'Library', 'Containers'),
      path.join(home, 'Library', 'Group Containers'),
      path.join(home, 'Library', 'Saved Application State'),
      path.join(home, 'Library', 'Developer'),
      path.join(home, 'Library', 'MobileDevice'),
    );
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    out.push(local, roaming, path.join(local, 'Temp'), process.env.Temp || '', path.join(home, 'Downloads'));
  } else {
    out.push(path.join(home, '.cache'), path.join(home, '.config'), path.join(home, '.local', 'share'));
  }
  return out.filter(Boolean);
}

export async function isElevated(): Promise<boolean> {
  try {
    if (process.platform !== 'win32') return typeof process.getuid === 'function' ? process.getuid() === 0 : false;
    const { runCmd } = await import('./util');
    const r = await runCmd('powershell', ['-NoProfile', '-Command', '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)']);
    return /true/i.test(r.stdout);
  } catch {
    return false;
  }
}

export function defaultScanRoots(): string[] {
  const home = os.homedir();
  const candidates = [home, path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Movies'), path.join(home, 'Pictures')];
  return candidates.filter((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}
