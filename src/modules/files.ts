import path from 'path';
import fs from 'fs';
import { mkItem } from './helpers';
import { collectFiles, hashFile, formatBytes, humanAge } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * Two file-level modules that answer "where did my disk go?":
 *   - large-files: the biggest individual filesystem objects under user content.
 *   - duplicates: byte-identical files (size -> partial hash -> full hash).
 * Both default to the OS recycle bin so nothing is destroyed outright.
 *
 * To stay fast we scan user content folders (Downloads/Desktop/...), skip heavy
 * or regenerable directories (node_modules, caches, system dirs) and cap both
 * recursion depth and the number of visited entries.
 */

const MAX_LARGE_ITEMS = 40;
const DUP_MIN_BYTES = 1024 * 1024;
const DUP_MAX_FILES = 20000;

const SKIP_SUFFIXES = ['.app', '.photoslibrary', '.tvlibrary', '.imovielibrary', '.aplibrary', '.lrlibrary', '.framework', '.bundle', '.plugin', '.xcodeproj', '.xcworkspace'];

const SKIP_DIRS = [
  'node_modules', '.git', 'Library', '.cache', '.Trash', '.npm', '.pnpm-store', 'AppData',
  'Applications', 'System', 'Volumes', 'proc', 'sys', 'dev', '__pycache__', '.venv', 'venv',
  '.gradle', '.cargo', '.rustup', '.m2', '.conda', '.local', '.docker', '.orbstack', '.colima',
  '.lima', '.ollama', '.huggingface', '.vscode-server', '.terraform.d', '.cursor', '.claude', '.codex',
];

function contentRoots(home: string, fallback: string[]): string[] {
  const candidates = ['Downloads', 'Desktop', 'Movies', 'Pictures', 'Documents', 'Music', 'Public'].map((n) => path.join(home, n));
  const existing = candidates.filter((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  return existing.length ? existing : fallback;
}

async function scanLarge(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const roots = contentRoots(ctx.home, ctx.opts.roots);
  const all: Array<{ path: string; size: number; mtimeMs: number }> = [];
  for (const root of roots) {
    try {
      const found = await collectFiles(root, { maxDepth: 6, minBytes: ctx.opts.minLargeBytes, skipDirs: SKIP_DIRS, skipSuffixes: SKIP_SUFFIXES });
      all.push(...found);
    } catch (e) {
      errors.push(`${root}: ${String(e)}`);
    }
  }
  all.sort((a, b) => b.size - a.size);
  for (const f of all.slice(0, MAX_LARGE_ITEMS)) {
    items.push(
      mkItem({
        module: 'large-files',
        category: '大文件',
        label: `${formatBytes(f.size)}  ${path.basename(f.path)}`,
        detail: `${f.path}\n修改于 ${humanAge(f.mtimeMs)}`,
        path: f.path,
        kind: 'file',
        bytes: f.size,
        risk: 'caution',
        defaultSelected: false,
        strategy: 'trash',
        meta: { mtimeMs: f.mtimeMs },
      }),
    );
  }
  notes.push(`扫描用户内容目录（${roots.map((r) => path.basename(r)).join('、')}），列出最大的 ${MAX_LARGE_ITEMS} 个（阈值 ≥ ${formatBytes(ctx.opts.minLargeBytes)}），清理方式为移入系统回收站，可恢复。`);
  return { module: 'large-files', title: '大文件', description: '找出占用最多的单个文件（视频、镜像、安装包等）。', category: 'largefiles', risk: 'caution', supported: true, items, notes, errors };
}

async function scanDuplicates(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const roots = contentRoots(ctx.home, ctx.opts.roots);

  const bySize = new Map<number, string[]>();
  let considered = 0;
  for (const root of roots) {
    let found: Array<{ path: string; size: number; mtimeMs: number }> = [];
    try {
      found = await collectFiles(root, { maxDepth: 6, minBytes: DUP_MIN_BYTES, skipDirs: SKIP_DIRS, skipSuffixes: SKIP_SUFFIXES, maxEntries: 60000 });
    } catch (e) {
      errors.push(`${root}: ${String(e)}`);
    }
    for (const f of found) {
      considered++;
      if (considered > DUP_MAX_FILES) break;
      const arr = bySize.get(f.size) ?? [];
      arr.push(f.path);
      bySize.set(f.size, arr);
    }
    if (considered > DUP_MAX_FILES) break;
  }

  let groups = 0;
  for (const [size, paths] of bySize) {
    if (paths.length < 2) continue;
    if (groups >= 60) break;
    const byPartial = new Map<string, string[]>();
    for (const p of paths) {
      try {
        const h = await hashFile(p, 'sha1', 65536);
        const arr = byPartial.get(h) ?? [];
        arr.push(p);
        byPartial.set(h, arr);
      } catch {
        /* ignore */
      }
    }
    for (const [, partialGroup] of byPartial) {
      if (partialGroup.length < 2) continue;
      const byFull = new Map<string, string[]>();
      for (const p of partialGroup) {
        try {
          const h = await hashFile(p, 'sha1');
          const arr = byFull.get(h) ?? [];
          arr.push(p);
          byFull.set(h, arr);
        } catch {
          /* ignore */
        }
      }
      for (const [, fullGroup] of byFull) {
        if (fullGroup.length < 2) continue;
        groups++;
        const sorted = [...fullGroup].sort();
        const keep = sorted[0];
        const dupes = sorted.slice(1);
        const wasted = size * dupes.length;
        items.push(
          mkItem({
            module: 'duplicates',
            category: '重复文件',
            label: `${dupes.length} 个重复 · 每个 ${formatBytes(size)}`,
            detail: `保留：${keep}\n重复：\n${dupes.join('\n')}`,
            paths: dupes,
            kind: 'group',
            bytes: wasted,
            count: dupes.length,
            risk: 'caution',
            defaultSelected: false,
            strategy: 'trash',
            meta: { keep, sample: dupes.slice(0, 6), size },
          }),
        );
      }
    }
  }
  notes.push('重复文件默认不勾选，并会保留每组中最先出现的一份；清理方式为移入回收站。');
  return { module: 'duplicates', title: '重复文件', description: '按内容比对的字节级重复文件。', category: 'duplicates', risk: 'caution', supported: true, items, notes, errors };
}

export const largeFilesModule: CleanerModule = {
  id: 'large-files',
  title: '大文件',
  description: '定位占用磁盘最多的单个文件。',
  category: 'largefiles',
  risk: 'caution',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan: scanLarge,
};

export const duplicatesModule: CleanerModule = {
  id: 'duplicates',
  title: '重复文件',
  description: '查找内容完全相同的重复文件。',
  category: 'duplicates',
  risk: 'caution',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: false,
  scan: scanDuplicates,
};
