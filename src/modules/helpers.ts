import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { dirSize, uid, exists, allocatedBytes } from '../core/util';
import type { CandidateItem, RiskLevel, CleanStrategy, ItemKind } from '../core/types';

export interface ItemSeed {
  module: string;
  category: string;
  label: string;
  detail?: string;
  path?: string;
  paths?: string[];
  bytes?: number;
  count?: number;
  kind?: ItemKind;
  risk?: RiskLevel;
  defaultSelected?: boolean;
  strategy?: CleanStrategy;
  command?: string;
  meta?: Record<string, unknown>;
}

export function mkItem(seed: ItemSeed): CandidateItem {
  const kind: ItemKind = seed.kind ?? (seed.paths && seed.paths.length > 1 ? 'group' : 'dir');
  const risk: RiskLevel = seed.risk ?? 'safe';
  return {
    id: uid(seed.module, seed.category, seed.label, seed.path ?? '', (seed.paths ?? []).join('|')),
    module: seed.module,
    category: seed.category,
    label: seed.label,
    detail: seed.detail,
    path: seed.path,
    paths: seed.paths,
    kind,
    bytes: seed.bytes ?? 0,
    count: seed.count,
    risk,
    defaultSelected: seed.defaultSelected ?? risk === 'safe',
    strategy: seed.strategy ?? 'quarantine',
    command: seed.command,
    meta: seed.meta,
  };
}

export async function sizeOf(p: string): Promise<{ bytes: number; count: number }> {
  try {
    const st = await fsp.lstat(p);
    if (st.isSymbolicLink()) return { bytes: 0, count: 0 };
    if (st.isFile()) return { bytes: allocatedBytes(st), count: 1 };
    const r = await dirSize(p);
    return { bytes: r.bytes, count: r.files + r.dirs };
  } catch {
    return { bytes: 0, count: 0 };
  }
}

export async function sumSizes(paths: string[]): Promise<{ bytes: number; count: number }> {
  let bytes = 0;
  let count = 0;
  for (const p of paths) {
    const s = await sizeOf(p);
    bytes += s.bytes;
    count += s.count;
  }
  return { bytes, count };
}

/** List immediate child directories that exist, with their sizes. */
export async function childDirs(root: string): Promise<Array<{ name: string; path: string; bytes: number; mtimeMs: number }>> {
  let dirents: fs.Dirent[] = [];
  try {
    dirents = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ name: string; path: string; bytes: number; mtimeMs: number }> = [];
  for (const d of dirents) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    const full = path.join(root, d.name);
    try {
      const st = await fsp.lstat(full);
      if (st.isSymbolicLink()) continue;
      const bytes = (await dirSize(full)).bytes;
      out.push({ name: d.name, path: full, bytes, mtimeMs: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  return out;
}

export function homeSub(rel: string, home: string): string {
  return path.join(home, rel);
}

export function firstExisting(paths: string[]): string[] {
  return paths.filter((p) => exists(p));
}

export function globDirsUnder(root: string, name: string, maxDepth = 6): string[] {
  const hits: string[] = [];
  function walk(p: string, depth: number): void {
    if (depth > maxDepth) return;
    let dirents: fs.Dirent[] = [];
    try {
      dirents = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (d.isSymbolicLink()) continue;
      const full = path.join(p, d.name);
      if (d.isDirectory()) {
        if (d.name === name) hits.push(full);
        if (d.name === 'node_modules' || d.name === '.git' || d.name.startsWith('.')) {
          // don't descend into heavy/irrelevant dirs (except we already matched)
        }
        walk(full, depth + 1);
      }
    }
  }
  walk(root, 0);
  return hits;
}

/** Synchronous recursive search for directories named in `markers` under roots. */
export function findMarkerDirsSync(root: string, markers: string[], maxDepth = 3): Array<{ marker: string; path: string; bytes: number }> {
  const skip = new Set(['node_modules', '.git', 'Library', 'Applications', 'AppData', '$RECYCLE.BIN', 'System Volume Information', '.cache', '.npm', '.pnpm-store', '.Trash', '.venv', 'venv', '.codex', '.claude', '.cursor', '.docker', '.orbstack', '.colima', '.lima', '.ollama', '.huggingface', 'DerivedData', 'Pods']);
  const out: Array<{ marker: string; path: string; bytes: number }> = [];
  function dirSizeSync(p: string): number {
    let total = 0;
    const stack = [p];
    while (stack.length) {
      const cur = stack.pop()!;
      let es: fs.Dirent[] = [];
      try {
        es = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of es) {
        const full = path.join(cur, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) stack.push(full);
        else {
          try {
            total += fs.lstatSync(full).size;
          } catch {
            /* ignore */
          }
        }
      }
    }
    return total;
  }
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let dirents: fs.Dirent[] = [];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (!d.isDirectory() || d.isSymbolicLink()) continue;
      const full = path.join(dir, d.name);
      if (markers.includes(d.name)) {
        try {
          out.push({ marker: d.name, path: full, bytes: dirSizeSync(full) });
        } catch {
          /* ignore */
        }
        continue;
      }
      if (skip.has(d.name)) continue;
      walk(full, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}
