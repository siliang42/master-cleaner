import path from 'path';
import { mkItem, sumSizes, findMarkerDirsSync } from './helpers';
import { exists, dirSize } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * Developer cache residue: package manager stores, language build caches,
 * Xcode artifacts and per-project build folders (node_modules, __pycache__,
 * .next, .venv, ...). These are the fastest way to free tens of GB on a dev
 * machine, and every one of them is regenerable.
 */

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const h = ctx.home;
  const L = path.join(h, 'Library');
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const win = ctx.platform === 'win32';
  const local = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');

  const dirs: Array<[string, string, string, 'safe' | 'caution']> = [
    [path.join(h, '.npm', '_cacache'), '包管理器缓存', 'npm 缓存 (_cacache)', 'safe'],
    [path.join(h, '.npm', '_logs'), '包管理器缓存', 'npm 日志', 'safe'],
    [path.join(h, '.pnpm-store'), '包管理器缓存', 'pnpm store', 'safe'],
    [path.join(L, 'pnpm', 'store'), '包管理器缓存', 'pnpm store (macOS)', 'safe'],
    [path.join(h, 'AppData', 'Local', 'pnpm', 'store'), '包管理器缓存', 'pnpm store (Windows)', 'safe'],
    [path.join(h, '.cache', 'yarn'), '包管理器缓存', 'Yarn 缓存', 'safe'],
    [path.join(L, 'Caches', 'Yarn'), '包管理器缓存', 'Yarn 缓存 (macOS)', 'safe'],
    [path.join(local, 'Yarn', 'Cache'), '包管理器缓存', 'Yarn 缓存 (Windows)', 'safe'],
    [path.join(h, '.bun', 'install', 'cache'), '包管理器缓存', 'Bun 安装缓存', 'safe'],
    [path.join(L, 'Caches', 'pip'), 'Python 缓存', 'pip 缓存 (macOS)', 'safe'],
    [path.join(h, '.cache', 'pip'), 'Python 缓存', 'pip 缓存', 'safe'],
    [path.join(local, 'pip', 'Cache'), 'Python 缓存', 'pip 缓存 (Windows)', 'safe'],
    [path.join(h, '.cache', 'uv'), 'Python 缓存', 'uv 缓存', 'safe'],
    [path.join(L, 'Caches', 'uv'), 'Python 缓存', 'uv 缓存 (macOS)', 'safe'],
    [path.join(h, '.cache', 'pypoetry'), 'Python 缓存', 'Poetry 缓存', 'safe'],
    [path.join(L, 'Caches', 'pypoetry'), 'Python 缓存', 'Poetry 缓存 (macOS)', 'safe'],
    [path.join(h, 'anaconda3', 'pkgs'), 'Python 缓存', 'conda 包缓存', 'safe'],
    [path.join(h, 'miniconda3', 'pkgs'), 'Python 缓存', 'conda 包缓存', 'safe'],
    [path.join(h, '.conda', 'pkgs'), 'Python 缓存', 'conda 包缓存', 'safe'],
    [path.join(h, '.cargo', 'registry', 'cache'), 'Rust / Go 缓存', 'Cargo 注册表缓存', 'safe'],
    [path.join(h, '.cargo', 'registry', 'src'), 'Rust / Go 缓存', 'Cargo 源码缓存', 'safe'],
    [path.join(h, '.cargo', 'git'), 'Rust / Go 缓存', 'Cargo git 缓存', 'safe'],
    [path.join(h, 'go', 'pkg', 'mod', 'cache', 'download'), 'Rust / Go 缓存', 'Go 模块下载缓存', 'safe'],
    [path.join(L, 'Caches', 'go-build'), 'Rust / Go 缓存', 'Go 构建缓存 (macOS)', 'safe'],
    [path.join(h, '.cache', 'go-build'), 'Rust / Go 缓存', 'Go 构建缓存', 'safe'],
    [path.join(h, '.gradle', 'caches'), 'JVM 构建缓存', 'Gradle 缓存', 'safe'],
    [path.join(h, '.gradle', 'wrapper', 'dists'), 'JVM 构建缓存', 'Gradle wrapper 发行版', 'safe'],
    [path.join(h, '.m2', 'repository'), 'JVM 构建缓存', 'Maven 本地仓库', 'caution'],
    [path.join(h, '.sbt'), 'JVM 构建缓存', 'sbt 缓存', 'safe'],
    [path.join(L, 'Caches', 'CocoaPods'), 'Apple 开发缓存', 'CocoaPods 缓存', 'safe'],
    [path.join(L, 'Developer', 'Xcode', 'DerivedData'), 'Apple 开发缓存', 'Xcode DerivedData', 'safe'],
    [path.join(L, 'Developer', 'Xcode', 'Archives'), 'Apple 开发缓存', 'Xcode Archives（打包产物）', 'caution'],
    [path.join(L, 'Developer', 'Xcode', 'iOS DeviceSupport'), 'Apple 开发缓存', 'Xcode iOS 设备支持符号', 'caution'],
    [path.join(L, 'Developer', 'CoreSimulator', 'Caches'), 'Apple 开发缓存', '模拟器缓存', 'safe'],
    [path.join(L, 'Caches', 'Homebrew'), 'Apple 开发缓存', 'Homebrew 下载缓存', 'safe'],
    [path.join(h, '.terraform.d', 'plugin-cache'), '其他构建缓存', 'Terraform 插件缓存', 'safe'],
    [path.join(h, '.cache', 'bazel'), '其他构建缓存', 'Bazel 缓存', 'safe'],
    [path.join(h, '.cache', 'puppeteer'), '其他构建缓存', 'Puppeteer 浏览器缓存', 'caution'],
    [path.join(h, '.cache', 'ms-playwright'), '其他构建缓存', 'Playwright 浏览器缓存', 'caution'],
    [path.join(h, '.cache', 'electron'), '其他构建缓存', 'Electron 下载缓存', 'safe'],
    [path.join(h, '.gradle', 'caches', 'modules-2'), 'JVM 构建缓存', 'Gradle 模块缓存', 'safe'],
  ];
  for (const [p, category, label, risk] of dirs) {
    if (!exists(p)) continue;
    try {
      const bytes = (await dirSize(p)).bytes;
      if (bytes <= 0) continue;
      items.push(mkItem({ module: 'dev-caches', category, label, path: p, bytes, risk, defaultSelected: risk === 'safe', strategy: 'quarantine' }));
    } catch (e) {
      errors.push(`${p}: ${String(e)}`);
    }
  }

  // Command-based cleanups (opt-in; the CLI/daemon runs them via the shell).
  const execs: Array<[string, string, string, 'safe']> = [
    ['npm cache clean --force', '包管理器缓存', 'npm 缓存（官方清理命令）', 'safe'],
    ['pnpm store prune', '包管理器缓存', 'pnpm store 清理（官方命令）', 'safe'],
    ['yarn cache clean', '包管理器缓存', 'Yarn 缓存清理（官方命令）', 'safe'],
    ['pip cache purge', 'Python 缓存', 'pip 缓存清理（官方命令）', 'safe'],
    ['uv cache clean', 'Python 缓存', 'uv 缓存清理（官方命令）', 'safe'],
    ['brew cleanup -s', 'Apple 开发缓存', 'Homebrew 清理（官方命令）', 'safe'],
  ];
  if (!win) {
    for (const [command, category, label, risk] of execs) {
      items.push(mkItem({ module: 'dev-caches', category, label, command, kind: 'command', risk, defaultSelected: false, strategy: 'exec' }));
    }
  }

  // Per-project build folders.
  try {
    const markers = ['node_modules', '__pycache__', '.venv', 'venv', '.next', '.nuxt', '.turbo', '.parcel-cache', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.ipynb_checkpoints', 'target'];
    const found = findMarkerDirsSync(ctx.opts.roots[0] || ctx.home, markers, 3);
    const byMarker = new Map<string, string[]>();
    for (const f of found) {
      const arr = byMarker.get(f.marker) ?? [];
      arr.push(f.path);
      byMarker.set(f.marker, arr);
    }
    for (const [marker, paths] of byMarker) {
      const s = await sumSizes(paths);
      if (s.bytes <= 0) continue;
      items.push(
        mkItem({
          module: 'dev-caches',
          category: '项目构建产物',
          label: `${marker}（${paths.length} 个）`,
          detail: paths.slice(0, 10).join('\n') + (paths.length > 10 ? `\n... 等 ${paths.length} 个` : ''),
          paths,
          kind: 'group',
          bytes: s.bytes,
          count: paths.length,
          risk: marker === 'target' || marker === '.venv' || marker === 'venv' ? 'caution' : 'safe',
          defaultSelected: false,
          strategy: 'quarantine',
          meta: { marker, sample: paths.slice(0, 10) },
        }),
      );
    }
    notes.push('项目构建产物默认不勾选；确认这些项目可重新构建后再清理。');
  } catch (e) {
    errors.push(String(e));
  }

  notes.push('Xcode Archives / iOS DeviceSupport 属打包与调试关键数据，请按需保留。');
  return { module: 'dev-caches', title: '开发者缓存', description: 'npm/pnpm/pip/cargo/gradle 等包管理缓存，Xcode 产物与项目 node_modules/venv 等构建目录。', category: 'dev', risk: 'safe', supported: true, items, notes, errors };
}

export const devModule: CleanerModule = {
  id: 'dev-caches',
  title: '开发者缓存',
  description: '包管理器缓存、语言构建缓存、Xcode 产物与项目构建目录。',
  category: 'dev',
  risk: 'safe',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan,
};
