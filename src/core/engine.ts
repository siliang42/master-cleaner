import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { ALL_MODULES } from '../modules';
import { Safety } from './safety';
import { Vault, newRunId } from './vault';
import { sendToTrash } from './trash';
import { configPath, historyPath } from './paths';
import { readJson, writeJson, formatBytes, dirSize, isSubPath, runCmd } from './util';
import { defaultScanRoots, diskUsage } from './platform';
import type { CleanRecord, CleanerModule, Ctx, CandidateItem, ModuleResult, ScanOptions, ScanReport, ExecOutcome } from './types';

export interface EngineConfig {
  disabledModules: string[];
  extraRoots: string[];
  minLargeBytes: number;
  minAgeDays: number;
  includeExpert: boolean;
  includeInfo: boolean;
}

export const DEFAULT_CONFIG: EngineConfig = {
  disabledModules: [],
  extraRoots: [],
  minLargeBytes: 100 * 1024 * 1024,
  minAgeDays: 0,
  includeExpert: false,
  includeInfo: true,
};

export function allModules(): CleanerModule[] {
  return ALL_MODULES;
}

export function moduleById(id: string): CleanerModule | undefined {
  return ALL_MODULES.find((m) => m.id === id);
}

export async function loadConfig(): Promise<EngineConfig> {
  const c = await readJson<Partial<EngineConfig>>(configPath(), {});
  return { ...DEFAULT_CONFIG, ...c };
}

export async function saveConfig(patch: Partial<EngineConfig>): Promise<EngineConfig> {
  const cur = await loadConfig();
  const next = { ...cur, ...patch };
  await writeJson(configPath(), next);
  return next;
}

export function buildOptions(cfg: EngineConfig, overrides: Partial<ScanOptions> = {}): ScanOptions {
  return {
    platform: process.platform,
    home: os.homedir(),
    env: process.env,
    roots: overrides.roots ?? defaultScanRoots(),
    minLargeBytes: overrides.minLargeBytes ?? cfg.minLargeBytes,
    includeExpert: overrides.includeExpert ?? cfg.includeExpert,
    includeInfo: overrides.includeInfo ?? cfg.includeInfo,
    maxDepth: overrides.maxDepth ?? 14,
    minAgeDays: overrides.minAgeDays ?? cfg.minAgeDays,
    now: Date.now(),
    verbose: overrides.verbose ?? false,
  };
}

export function ctxFrom(opts: ScanOptions, log: (m: string) => void = () => undefined): Ctx {
  return { opts, platform: opts.platform, home: opts.home, log };
}

function sanitize(result: ModuleResult, opts: ScanOptions): ModuleResult {
  let items = result.items;
  if (!opts.includeInfo) items = items.filter((i) => i.strategy !== 'info');
  items = items.map((i) => {
    if (i.risk === 'expert' && !opts.includeExpert) return { ...i, defaultSelected: false };
    return i;
  });
  return { ...result, items };
}

export interface ScanArgs {
  moduleIds?: string[];
  opts?: Partial<ScanOptions>;
  log?: (m: string) => void;
}

export async function runScan(args: ScanArgs = {}): Promise<ScanReport> {
  const cfg = await loadConfig();
  const opts = buildOptions(cfg, args.opts ?? {});
  const log = args.log ?? (() => undefined);
  const wanted = args.moduleIds && args.moduleIds.length ? new Set(args.moduleIds) : null;
  const modules = ALL_MODULES.filter((m) => {
    if (cfg.disabledModules.includes(m.id)) return false;
    if (wanted) return wanted.has(m.id) || wanted.has(m.category);
    // With no explicit selection, only run modules enabled by default so a
    // first "scan" stays fast (heavy opt-in modules like duplicates are skipped).
    return m.defaultEnabled;
  });

  const startedAt = Date.now();
  const results: ModuleResult[] = [];
  const errors: string[] = [];
  for (const m of modules) {
    if (!m.platforms.includes(process.platform)) {
      results.push({ module: m.id, title: m.title, description: m.description, category: m.category, risk: m.risk, supported: false, items: [], notes: [`当前平台（${process.platform}）不支持此模块`], errors: [] });
      continue;
    }
    log(`扫描 ${m.title} ...`);
    try {
      const r = await m.scan(ctxFrom(opts, log));
      results.push(sanitize(r, opts));
    } catch (e) {
      const msg = `${m.id}: ${String(e)}`;
      errors.push(msg);
      log(`  ! ${msg}`);
      results.push({ module: m.id, title: m.title, description: m.description, category: m.category, risk: m.risk, supported: true, items: [], notes: [], errors: [String(e)] });
    }
  }
  markDuplicates(results);
  const flat = results.flatMap((r) => r.items);
  const live = flat.filter((i) => !i.duplicate);
  const reclaimableBytes = live.filter((i) => i.strategy !== 'info').reduce((a, i) => a + (i.bytes || 0), 0);
  const reportOnlyBytes = live.filter((i) => i.strategy === 'info').reduce((a, i) => a + (i.bytes || 0), 0);
  const duplicateBytes = flat.filter((i) => i.duplicate).reduce((a, i) => a + (i.bytes || 0), 0);
  const selectedBytes = live.filter((i) => i.defaultSelected && i.strategy !== 'info').reduce((a, i) => a + (i.bytes || 0), 0);
  return {
    startedAt,
    finishedAt: Date.now(),
    platform: process.platform,
    modules: results,
    totalBytes: reclaimableBytes + reportOnlyBytes,
    totalItems: flat.length,
    reclaimableBytes,
    reportOnlyBytes,
    duplicateBytes,
    selectedBytes,
    errors,
  };
}

/** Resolve the paths an item claims to account for (absolute, deduped). */
function itemPaths(item: CandidateItem): string[] {
  const raw = item.paths && item.paths.length ? item.paths : item.path ? [item.path] : [];
  return Array.from(new Set(raw.map((p) => path.resolve(p))));
}

/**
 * Flag items whose paths are already fully accounted for by another item, so
 * overlapping scans never inflate the totals. The classic case: a Docker.app
 * uninstall entry and the container module both point at `Docker.raw`; only the
 * larger scope should be counted. The largest item wins; a contained item is
 * marked `duplicate` and excluded from the aggregates (it stays cleanable).
 */
function markDuplicates(results: ModuleResult[]): void {
  const items = results.flatMap((r) => r.items);
  const entries = items
    .map((item, idx) => ({ item, paths: itemPaths(item), idx }))
    .filter((e) => e.paths.length > 0)
    .sort((a, b) => b.item.bytes - a.item.bytes || a.paths.length - b.paths.length || a.idx - b.idx);
  const claimed: Array<{ path: string; id: string }> = [];
  for (const e of entries) {
    const covered = e.paths.every((p) => claimed.some((c) => isSubPath(c.path, p)));
    if (covered) {
      const owner = claimed.find((c) => isSubPath(c.path, e.paths[0]));
      e.item.duplicate = true;
      if (owner) e.item.duplicateOf = owner.id;
      continue;
    }
    for (const p of e.paths) claimed.push({ path: p, id: e.item.id });
  }
}

async function itemBytes(item: CandidateItem): Promise<number> {
  if (item.bytes > 0) return item.bytes;
  const p = item.path;
  if (!p) return 0;
  try {
    const st = await fsp.lstat(p);
    return st.isDirectory() ? (await dirSize(p)).bytes : st.size;
  } catch {
    return 0;
  }
}

export type CleanMode = 'quarantine' | 'trash' | 'delete' | 'dry-run';

export interface CleanArgs {
  mode?: CleanMode;
  dryRun?: boolean;
  log?: (m: string) => void;
  moduleExec?: (item: CandidateItem, ctx: Ctx) => Promise<ExecOutcome>;
}

export interface CleanResult {
  record: CleanRecord;
  skipped: Array<{ label: string; path?: string; reason: string }>;
}

export async function runClean(items: CandidateItem[], args: CleanArgs = {}): Promise<CleanResult> {
  const cfg = await loadConfig();
  const opts = buildOptions(cfg, {});
  const ctx = ctxFrom(opts);
  const log = args.log ?? (() => undefined);
  const dryRun = args.dryRun ?? false;
  const mode: CleanMode = args.mode ?? 'quarantine';
  const safety = new Safety(process.platform, cfg.extraRoots);
  const vault = new Vault();
  const runId = newRunId();

  const record: CleanRecord = { id: runId, at: Date.now(), mode: dryRun ? 'dry-run' : mode, items: [], removed: 0, bytes: 0, errors: [] };
  const skipped: Array<{ label: string; path?: string; reason: string }> = [];

  for (const item of items) {
    if (item.strategy === 'info') continue;
    if (item.strategy === 'exec') {
      if (dryRun) {
        record.items.push({ id: item.id, label: item.label, bytes: 0, paths: [], strategy: 'exec' });
        continue;
      }
      let out: ExecOutcome | undefined;
      const modExec = args.moduleExec || (moduleById(item.module)?.exec ? (i: CandidateItem, c: Ctx) => moduleById(item.module)!.exec!(i, c) : undefined);
      if (modExec) {
        log(`执行 ${item.label} ...`);
        out = await modExec(item, ctx);
      } else if (item.command) {
        log(`执行命令：${item.command}`);
        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
        const cargs = process.platform === 'win32' ? ['/c', item.command] : ['-c', item.command];
        const r = await runCmd(shell, cargs, { timeoutMs: 15 * 60 * 1000 });
        out = { removed: r.ok ? 1 : 0, bytes: item.bytes || 0, skipped: 0, errors: r.ok ? [] : [r.stderr.slice(0, 400)] };
      }
      if (!out) {
        skipped.push({ label: item.label, reason: '无可执行器' });
        continue;
      }
      record.removed += out.removed;
      record.bytes += out.bytes;
      record.errors.push(...out.errors);
      continue;
    }

    const rawPaths = item.paths && item.paths.length ? item.paths : item.path ? [item.path] : [];
    const safePaths: string[] = [];
    for (const p of rawPaths) {
      const v = safety.verdict(p);
      if (!v.ok) {
        skipped.push({ label: item.label, path: p, reason: v.reason });
        continue;
      }
      if (!fs.existsSync(p)) continue;
      safePaths.push(p);
    }
    if (!safePaths.length) continue;

    if (dryRun) {
      const bytes = await itemBytes(item);
      record.items.push({ id: item.id, label: item.label, bytes, paths: safePaths, strategy: item.strategy });
      record.bytes += bytes;
      record.removed += safePaths.length;
      continue;
    }

    const effective: CleanMode = mode === 'quarantine' ? item.strategy === 'delete' ? 'delete' : mode : mode;
    let moved = 0;
    let bytes = 0;

    if (effective === 'delete') {
      for (const p of safePaths) {
        try {
          const b = await itemBytes({ ...item, path: p, paths: undefined });
          await fsp.rm(p, { recursive: true, force: true });
          moved++;
          bytes += b;
        } catch (e) {
          record.errors.push(`删除失败 ${p}: ${String(e)}`);
        }
      }
    } else if (effective === 'trash') {
      const failed = await sendToTrash(safePaths, process.platform);
      for (const p of safePaths) {
        if (failed.includes(p)) {
          // fall back to vault so nothing is lost
          const run = await vault.save(runId, 'trash->vault', [p]);
          const e = run.entries.find((x) => x.original === p);
          if (e) {
            moved++;
            bytes += e.bytes;
          }
        } else {
          moved++;
          bytes += await itemBytes({ ...item, path: p, paths: undefined });
        }
      }
    } else {
      const run = await vault.save(runId, 'quarantine', safePaths);
      for (const p of safePaths) {
        const e = run.entries.find((x) => x.original === p);
        if (e) {
          moved++;
          bytes += e.bytes;
        }
      }
    }

    if (moved > 0) {
      record.items.push({ id: item.id, label: item.label, bytes, paths: safePaths, strategy: item.strategy });
      record.removed += moved;
      record.bytes += bytes;
      log(`已清理 ${item.label} (${formatBytes(bytes)})`);
    }
  }

  await appendHistory(record);
  return { record, skipped };
}

async function appendHistory(rec: CleanRecord): Promise<void> {
  const hist = await readJson<CleanRecord[]>(historyPath(), []);
  hist.push(rec);
  while (hist.length > 200) hist.shift();
  await fsp.mkdir(path.dirname(historyPath()), { recursive: true });
  await fsp.writeFile(historyPath(), JSON.stringify(hist, null, 2), 'utf8');
}

/** Guard used by modules that hand back user-supplied roots. */
export function withinAnyRoot(p: string, roots: string[]): boolean {
  return roots.some((r) => isSubPath(r, p));
}

export function overallDisk() {
  return diskUsage(os.homedir());
}
