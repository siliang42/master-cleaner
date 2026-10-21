import path from 'path';
import fs from 'fs';
import { mkItem, sumSizes } from './helpers';
import { dirSize, formatBytes } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * Project work residue ("项目工作残留").
 *
 * AI agents and editors leave non-source debris inside project folders: merge
 * leftovers (`*.orig` / `*.rej`), Vim swap files, `.DS_Store`, old logs, crash
 * dumps, updater-style backups and tool session output under `.playwright-cli`
 * / `.playwright-mcp`. This module surfaces exactly those high-confidence
 * items and nothing else.
 *
 * Hard boundaries:
 *  - only allow-listed filename patterns become candidates; source code and
 *    documents are never guessed at;
 *  - files whose names look like credentials / tokens / sessions / keys are
 *    skipped entirely and only counted as protected;
 *  - inside agent tool dirs (`.claude`, `.codex`, …) only regenerable
 *    sub-directories (cache/tmp/logs/shell-snapshots/…) are proposed, so
 *    settings, commands, memory, skills, rules and worktrees stay untouched;
 *  - backups (`*.bak`), logs and crash dumps are `caution` and never
 *    pre-selected — they may hold something the user wants.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Heavy or irrelevant directories: never walked while looking for projects. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'Library',
  'Applications',
  'AppData',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.Trash',
  '.npm',
  '.pnpm-store',
  '.venv',
  'venv',
  '.tox',
  'dist',
  'build',
  'out',
  'target',
  'release',
  'Pods',
  'DerivedData',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'vendor',
  'coverage',
  '.terraform',
]);

/** Directories that mark the root of a project. */
const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'Gemfile',
  'CMakeLists.txt',
];

/** Agent / editor tool dirs that live inside projects. */
const TOOL_DIRS = new Set(['.claude', '.codex', '.cursor', '.continue', '.specstory', '.windsurf', '.gemini', '.agent', '.qwen']);

/** Inside tool dirs, only these names are regenerable session scratch. */
const TOOL_SCRATCH = new Set(['cache', 'caches', 'tmp', 'temp', 'logs', 'log', 'shell-snapshots', 'statsig', 'crashpad']);

/** Playwright CLI / MCP session output. */
const PLAYWRIGHT_DIRS = new Set(['.playwright-cli', '.playwright-mcp']);

/** Anything looking like credentials is never listed, let alone cleaned. */
const SENSITIVE_NAME = /(credential|secret|keychain|password|passwd|cookie|private[-_.]?key|api[-_.]?key|access[-_.]?key)/i;
const BOUNDARY_NAME = /(^|[._-])(tokens?|sessions?|auth|login|signin|sign-in)([._-]|$)/i;

function isProtectedName(name: string): boolean {
  return SENSITIVE_NAME.test(name) || BOUNDARY_NAME.test(name) || /\.env(\.|$)/i.test(name);
}

type Bucket = 'editor' | 'backup' | 'log' | 'dump';

interface Hit {
  path: string;
  bytes: number;
}

function classifyFile(name: string, mtimeMs: number, now: number): Bucket | null {
  if (isProtectedName(name)) return null;
  if (name === '.DS_Store' || /~$/.test(name) || /\.(orig|rej)$/i.test(name)) return 'editor';
  if (/\.sw[op]$/i.test(name)) return now - mtimeMs > DAY ? 'editor' : null; // live editor session?
  if (/\.(bak|backup|old|save)([.-]|$)/i.test(name)) return 'backup';
  if (/\.log$/i.test(name) || /^nohup\.out$/i.test(name)) return 'log';
  if (/^core\.\d+$/.test(name)) return 'dump';
  return null;
}

function isProjectRoot(dir: string): boolean {
  return PROJECT_MARKERS.some((m) => {
    try {
      return fs.existsSync(path.join(dir, m));
    } catch {
      return false;
    }
  });
}

/** Breadth-limited search for project roots under the scan roots. */
function findProjects(root: string, maxDepth: number, out: Set<string>): void {
  if (isProjectRoot(root)) {
    out.add(root);
    return;
  }
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    if (depth >= maxDepth) continue;
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(e.name) || e.name.endsWith('.photoslibrary')) continue;
      const full = path.join(dir, e.name);
      if (isProjectRoot(full)) out.add(full);
      else stack.push({ dir: full, depth: depth + 1 });
    }
  }
}

interface ProjectScan {
  buckets: Record<Bucket, Hit[]>;
  toolCacheDirs: string[];
  playwright: Hit[];
  worktrees: string[];
  protectedCount: number;
}

function newScan(): ProjectScan {
  return {
    buckets: { editor: [], backup: [], log: [], dump: [] },
    toolCacheDirs: [],
    playwright: [],
    worktrees: [],
    protectedCount: 0,
  };
}

/** Collect the regenerable scratch sub-directories inside an agent tool dir. */
function scanToolDir(dir: string, out: ProjectScan): void {
  let ents: fs.Dirent[] = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (e.name === 'worktrees') {
        out.worktrees.push(full);
        continue;
      }
      if (TOOL_SCRATCH.has(e.name)) out.toolCacheDirs.push(full);
      continue;
    }
    if (isProtectedName(e.name)) out.protectedCount++;
  }
}

/** Playwright session output older than a week. */
function scanPlaywrightDir(dir: string, out: ProjectScan, now: number): void {
  const stack: Array<{ p: string; depth: number }> = [{ p: dir, depth: 0 }];
  while (stack.length) {
    const { p, depth } = stack.pop()!;
    if (depth > 6) continue;
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(p, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        stack.push({ p: full, depth: depth + 1 });
        continue;
      }
      try {
        const st = fs.lstatSync(full);
        if (now - st.mtimeMs > 7 * DAY) out.playwright.push({ path: full, bytes: st.size });
      } catch {
        /* ignore */
      }
    }
  }
}

function scanProject(proj: string, out: ProjectScan, now: number): void {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: proj, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    if (depth > 5) continue;
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (TOOL_DIRS.has(e.name)) {
          scanToolDir(full, out);
          continue;
        }
        if (PLAYWRIGHT_DIRS.has(e.name)) {
          scanPlaywrightDir(full, out, now);
          continue;
        }
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (isProtectedName(e.name)) {
        out.protectedCount++;
        continue;
      }
      let mtimeMs = 0;
      let bytes = 0;
      try {
        const st = fs.lstatSync(full);
        mtimeMs = st.mtimeMs;
        bytes = st.size;
      } catch {
        continue;
      }
      const kind = classifyFile(e.name, mtimeMs, now);
      if (kind) out.buckets[kind].push({ path: full, bytes });
    }
  }
}

async function groupItem(
  bucket: Hit[],
  opts: {
    category: string;
    label: (n: number) => string;
    detail: string;
    risk: CandidateItem['risk'];
    defaultSelected: boolean;
    strategy: CandidateItem['strategy'];
    module: string;
  },
): Promise<CandidateItem | null> {
  if (!bucket.length) return null;
  const paths = bucket.map((h) => h.path).sort();
  const sizes = await sumSizes(paths);
  const bytes = sizes.bytes || bucket.reduce((a, h) => a + h.bytes, 0);
  if (bytes <= 0 && bucket.length === 0) return null;
  const sample = paths.slice(0, 8).join('\n') + (paths.length > 8 ? `\n... 共 ${paths.length} 个` : '');
  return mkItem({
    module: opts.module,
    category: opts.category,
    label: opts.label(paths.length),
    detail: `${opts.detail}\n${sample}`,
    paths,
    kind: 'group',
    bytes,
    count: paths.length,
    risk: opts.risk,
    defaultSelected: opts.defaultSelected,
    strategy: opts.strategy,
  });
}

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const now = ctx.opts.now;

  const projects = new Set<string>();
  for (const root of ctx.opts.roots) {
    try {
      findProjects(root, 4, projects);
    } catch (e) {
      errors.push(`${root}: ${String(e)}`);
    }
  }

  const out = newScan();
  for (const proj of projects) {
    try {
      scanProject(proj, out, now);
    } catch (e) {
      errors.push(`${proj}: ${String(e)}`);
    }
  }

  const mk = (item: Awaited<ReturnType<typeof groupItem>>) => {
    if (item) items.push(item);
  };

  mk(
    await groupItem(out.buckets.editor, {
      module: 'project-residue',
      category: '编辑器与合并残片',
      label: (n) => `编辑器与合并残片 × ${n}`,
      detail: '.DS_Store、Vim 交换文件与 git 合并残留（*.orig / *.rej / *~），删除后不会影响项目源代码。',
      risk: 'safe',
      defaultSelected: true,
      strategy: 'delete',
    }),
  );
  mk(
    await groupItem(out.buckets.backup, {
      module: 'project-residue',
      category: '备份文件',
      label: (n) => `项目内备份文件 × ${n}`,
      detail: '匹配 *.bak / *.backup / *.old / *.save。这些可能是有意保留的备份，请确认后再勾选（默认移入安全回收站，可还原）。',
      risk: 'caution',
      defaultSelected: false,
      strategy: 'quarantine',
    }),
  );
  mk(
    await groupItem(out.buckets.log, {
      module: 'project-residue',
      category: '项目日志',
      label: (n) => `项目内日志文件 × ${n}`,
      detail: '构建、测试与工具运行日志；排障时可能有用，默认不勾选。',
      risk: 'caution',
      defaultSelected: false,
      strategy: 'quarantine',
    }),
  );
  mk(
    await groupItem(out.buckets.dump, {
      module: 'project-residue',
      category: '崩溃转储',
      label: (n) => `崩溃转储 × ${n}`,
      detail: '进程崩溃时产生的 core 文件，仅用于事后调试；如无排障需求可清理。',
      risk: 'caution',
      defaultSelected: false,
      strategy: 'quarantine',
    }),
  );
  mk(
    await groupItem(out.playwright, {
      module: 'project-residue',
      category: '工具会话输出',
      label: (n) => `Playwright 会话输出 × ${n}（超过 7 天）`,
      detail: 'Playwright CLI / MCP 在项目里留下的日志与快照，重新运行即可再生成。',
      risk: 'safe',
      defaultSelected: true,
      strategy: 'quarantine',
    }),
  );

  if (out.toolCacheDirs.length) {
    let bytes = 0;
    for (const d of out.toolCacheDirs) {
      try {
        bytes += (await dirSize(d)).bytes;
      } catch {
        /* ignore */
      }
    }
    if (bytes > 0)
      items.push(
        mkItem({
          module: 'project-residue',
          category: 'Agent 工具缓存',
          label: `AI agent 工具缓存 × ${out.toolCacheDirs.length}`,
          detail: `只包含 cache / tmp / logs / shell-snapshots 等可再生的临时子目录；配置、命令、记忆、skills 与 worktree 都不会被触碰。\n${out.toolCacheDirs.slice(0, 8).join('\n')}`,
          paths: out.toolCacheDirs.sort(),
          kind: 'group',
          bytes,
          count: out.toolCacheDirs.length,
          risk: 'safe',
          defaultSelected: true,
          strategy: 'quarantine',
        }),
      );
  }

  if (out.worktrees.length) {
    let bytes = 0;
    for (const d of out.worktrees) {
      try {
        bytes += (await dirSize(d)).bytes;
      } catch {
        /* ignore */
      }
    }
    items.push(
      mkItem({
        module: 'project-residue',
        category: '待确认',
        label: `Agent worktree × ${out.worktrees.length}（需人工确认）`,
        detail: `agent 在项目里创建的 git worktree，可能包含未合并的改动，因此只报告不清理：\n${out.worktrees.slice(0, 8).join('\n')}`,
        paths: out.worktrees.sort(),
        kind: 'info',
        bytes,
        count: out.worktrees.length,
        risk: 'expert',
        defaultSelected: false,
        strategy: 'info',
      }),
    );
  }

  notes.push(`扫描了 ${projects.size} 个项目根（含 .git 或构建清单文件），共发现 ${items.length} 类残留。`);
  notes.push('只匹配高置信度残片（交换文件/合并残留/备份/日志/崩溃转储/工具缓存）；源代码、文档与未跟踪文件不会被猜测删除。');
  if (out.protectedCount) notes.push(`已保护 ${out.protectedCount} 个疑似凭据 / 会话 / 密钥文件，它们不会被列出或清理。`);
  notes.push('Agent 工具目录只清理白名单内的临时子目录；settings、commands、memory、skills、rules 与 worktrees 保持不变。');

  return {
    module: 'project-residue',
    title: '项目工作残留',
    description: '项目里的非源码残留：编辑器与合并残片、备份、日志、崩溃转储、AI agent 工具缓存与工具会话输出。',
    category: 'dev',
    risk: 'safe',
    supported: true,
    items,
    notes,
    errors,
  };
}

export const projectResidueModule: CleanerModule = {
  id: 'project-residue',
  title: '项目工作残留',
  description: '项目里的非源码残留：编辑器与合并残片、备份、日志、崩溃转储、AI agent 工具缓存与工具会话输出。',
  category: 'dev',
  risk: 'safe',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan,
};
