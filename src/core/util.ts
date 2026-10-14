import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';

/** Format bytes into a compact human string. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function humanAge(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts);
  const day = 86400000;
  if (d < 3600_000) return `${Math.round(d / 60000)} 分钟前`;
  if (d < day) return `${Math.round(d / 3600_000)} 小时前`;
  if (d < 30 * day) return `${Math.round(d / day)} 天前`;
  if (d < 365 * day) return `${Math.round(d / (30 * day))} 个月前`;
  return `${(d / (365 * day)).toFixed(1)} 年前`;
}

export function expandHome(p: string, home = os.homedir()): string {
  if (!p) return p;
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

export function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

export interface DirSizeResult {
  bytes: number;
  files: number;
  dirs: number;
}

/**
 * The number of bytes a file actually occupies on disk.
 *
 * `st.size` is the *logical* length, which badly over-reports sparse files
 * (Docker.raw / *.vhdx / *.qcow2 VM images are frequently 100x larger than
 * their real footprint) and APFS/HFS compressed files. Those files report far
 * fewer allocated blocks than their logical size, so we use the block count
 * when the platform provides it and only ever report the smaller of the two.
 */
export function allocatedBytes(st: fs.Stats): number {
  if (!st.isFile()) return 0;
  const blocks = (st as fs.Stats & { blocks?: number }).blocks;
  if (typeof blocks === 'number' && blocks > 0) {
    const onDisk = blocks * 512; // POSIX stat blocks are always 512-byte units.
    return Math.min(st.size, onDisk);
  }
  return st.size;
}

/**
 * Compute the total size of a directory (or single file) without following
 * symlinks, swallowing permission errors. Depth-limited to stay predictable.
 * Sizes reflect real disk usage (sparse-aware) and hard-linked files are
 * counted once so shared frameworks never inflate the total.
 */
export async function dirSize(
  target: string,
  opts: { maxDepth?: number; maxEntries?: number } = {},
): Promise<DirSizeResult> {
  const maxDepth = opts.maxDepth ?? 64;
  const maxEntries = opts.maxEntries ?? 2_000_000;
  const out: DirSizeResult = { bytes: 0, files: 0, dirs: 0 };
  let entries = 0;
  const seenInodes = new Set<string>();

  async function walk(p: string, depth: number): Promise<void> {
    if (depth > maxDepth || entries > maxEntries) return;
    let st: fs.Stats;
    try {
      st = await fsp.lstat(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      // Hard links share one inode; only charge the first one we encounter.
      if (st.nlink > 1) {
        const key = `${st.dev}:${st.ino}`;
        if (seenInodes.has(key)) return;
        seenInodes.add(key);
      }
      out.bytes += allocatedBytes(st);
      out.files += 1;
      entries += 1;
      return;
    }
    if (!st.isDirectory()) return;
    out.dirs += 1;
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (entries > maxEntries) break;
      await walk(path.join(p, d.name), depth + 1);
    }
  }

  await walk(target, 0);
  return out;
}

export async function listDir(p: string): Promise<string[]> {
  try {
    return await fsp.readdir(p);
  } catch {
    return [];
  }
}

/** Recursively collect files under root (depth-limited, symlink-safe). */
export async function collectFiles(
  root: string,
  opts: { maxDepth?: number; minBytes?: number; olderThanMs?: number; now?: number; skipDirs?: Iterable<string>; skipSuffixes?: string[]; maxEntries?: number } = {},
): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
  const maxDepth = opts.maxDepth ?? 12;
  const minBytes = opts.minBytes ?? 0;
  const now = opts.now ?? Date.now();
  const skip = new Set(opts.skipDirs ?? []);
  const skipSuffix = opts.skipSuffixes ?? [];
  const maxEntries = opts.maxEntries ?? 300_000;
  const out: Array<{ path: string; size: number; mtimeMs: number }> = [];
  let visited = 0;

  async function walk(p: string, depth: number): Promise<void> {
    if (depth > maxDepth || visited > maxEntries) return;
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      visited++;
      if (visited > maxEntries) return;
      if (skip.has(d.name)) continue;
      if (skipSuffix.length && skipSuffix.some((s) => d.name.endsWith(s))) continue;
      const full = path.join(p, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        await walk(full, depth + 1);
      } else if (d.isFile()) {
        try {
          const st = await fsp.lstat(full);
          if (st.size < minBytes) continue;
          if (opts.olderThanMs && now - st.mtimeMs < opts.olderThanMs) continue;
          out.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  }

  await walk(root, 0);
  return out;
}

export async function hashFile(p: string, algo = 'sha1', maxBytes?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    const stream = fs.createReadStream(p, maxBytes ? { end: maxBytes - 1 } : undefined);
    stream.on('data', (d) => h.update(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
  ok: boolean;
}

export function runCmd(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CmdResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        {
          timeout: opts.timeoutMs ?? 60_000,
          cwd: opts.cwd,
          env: opts.env,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
          resolve({
            code,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? err?.message ?? ''),
            ok: !err,
          });
        },
      );
    } catch (e) {
      resolve({ code: 1, stdout: '', stderr: String(e), ok: false });
    }
  });
}

export async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(p: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, JSON.stringify(value, null, 2), 'utf8');
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function dayStartMs(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** True when `child` is inside (or equal to) `parent`. */
export function isSubPath(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

export function uid(...parts: string[]): string {
  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}
