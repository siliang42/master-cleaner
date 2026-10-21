import path from 'path';
import os from 'os';
import { mkItem, childDirs, sumSizes } from './helpers';
import { exists, dirSize, formatBytes } from '../core/util';
import { isElevated } from '../core/platform';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/** Aggregate small cache folders into a single "其他小缓存" item to keep lists tidy. */
async function aggregateCaches(
  root: string,
  module: string,
  category: string,
  minItemBytes: number,
  detailPrefix: string,
): Promise<CandidateItem[]> {
  if (!exists(root)) return [];
  const dirs = await childDirs(root);
  const big = dirs.filter((d) => d.bytes >= minItemBytes).sort((a, b) => b.bytes - a.bytes);
  const small = dirs.filter((d) => d.bytes < minItemBytes);
  const items: CandidateItem[] = big.map((d) =>
    mkItem({
      module,
      category,
      label: d.name,
      detail: `${detailPrefix}：${d.path}`,
      path: d.path,
      bytes: d.bytes,
      risk: 'safe',
      defaultSelected: true,
      strategy: 'quarantine',
    }),
  );
  if (small.length) {
    const total = small.reduce((a, d) => a + d.bytes, 0);
    items.push(
      mkItem({
        module,
        category,
        label: `其他小缓存（${small.length} 项）`,
        detail: `${detailPrefix}：${root}`,
        paths: small.map((d) => d.path),
        kind: 'group',
        bytes: total,
        count: small.length,
        risk: 'safe',
        defaultSelected: true,
        strategy: 'quarantine',
      }),
    );
  }
  return items;
}

async function macScan(ctx: Ctx): Promise<ModuleResult> {
  const home = ctx.home;
  const items: CandidateItem[] = [];
  const notes: string[] = [];

  items.push(
    ...(await aggregateCaches(path.join(home, 'Library', 'Caches'), 'system-junk', '应用缓存', 2 * 1024 * 1024, '用户级应用缓存，可安全重建')),
  );

  // Logs & crash reports
  const logsRoot = path.join(home, 'Library', 'Logs');
  if (exists(logsRoot)) {
    const s = await sumSizes([logsRoot]);
    if (s.bytes > 0)
      items.push(mkItem({ module: 'system-junk', category: '日志与崩溃报告', label: '用户日志 (~/Library/Logs)', path: logsRoot, bytes: s.bytes, count: s.count, risk: 'safe', defaultSelected: true, strategy: 'quarantine' }));
  }
  for (const extra of ['Application Support/CrashReporter', 'Logs/DiagnosticReports']) {
    const p = path.join(home, 'Library', extra);
    if (exists(p)) {
      const s = await sumSizes([p]);
      if (s.bytes > 0) items.push(mkItem({ module: 'system-junk', category: '日志与崩溃报告', label: path.basename(extra), path: p, bytes: s.bytes, count: s.count, risk: 'safe', defaultSelected: true, strategy: 'quarantine' }));
    }
  }

  const sas = path.join(home, 'Library', 'Saved Application State');
  if (exists(sas)) {
    const s = await sumSizes([sas]);
    if (s.bytes > 0) items.push(mkItem({ module: 'system-junk', category: '应用状态', label: '保存的应用恢复状态', path: sas, bytes: s.bytes, count: s.count, risk: 'safe', defaultSelected: true, strategy: 'quarantine' }));
  }

  // User temp dir ($TMPDIR -> /private/var/folders/...). Report-only: the
  // whole directory is shared with every running app, so moving it wholesale
  // can break live sessions. Concrete, age-gated residue inside it is cleaned
  // item by item by the `hidden-space` module instead.
  const tmp = os.tmpdir();
  if (exists(tmp)) {
    const s = await sumSizes([tmp]);
    items.push(mkItem({ module: 'system-junk', category: '系统临时文件', label: `用户临时目录占用（${formatBytes(s.bytes)}）`, bytes: s.bytes, count: s.count, risk: 'caution', defaultSelected: false, strategy: 'info', detail: '这是所有正在运行的程序共享的会话临时区；由「macOS 隐藏空间」模块逐项清理其中的过期残留，比整目录移动更安全。' }));
  }

  const elevated = await isElevated();
  notes.push(elevated ? '已获得管理员权限，可显示系统级缓存。' : '系统级缓存（/Library、/private/var）需要 sudo 才能清理，当前仅报告。');
  return { module: 'system-junk', title: '系统垃圾（macOS）', description: '缓存、日志、崩溃报告、临时文件等可安全重建的数据。', category: 'system', risk: 'safe', supported: true, items, notes, errors: [] };
}

async function winScan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const local = process.env.LOCALAPPDATA || path.join(ctx.home, 'AppData', 'Local');
  const winDir = process.env.SystemRoot || 'C:\\Windows';
  const elevated = await isElevated();

  const push = async (p: string, category: string, label: string, risk: 'safe' | 'caution' | 'expert', selected: boolean, detail?: string, strategy: 'quarantine' | 'trash' | 'delete' | 'info' = 'quarantine') => {
    if (!exists(p)) return;
    const s = await sumSizes([p]);
    if (s.bytes <= 0 && strategy !== 'info') return;
    items.push(mkItem({ module: 'windows-system', category, label, path: p, bytes: s.bytes, count: s.count, risk, defaultSelected: selected, strategy, detail }));
  };

  await push(path.join(local, 'Temp'), '临时文件', '用户临时目录 (%TEMP%)', 'safe', true);
  if (process.env.Temp) await push(process.env.Temp, '临时文件', 'TEMP 环境变量目录', 'safe', true);
  await push(path.join(local, 'CrashDumps'), '崩溃与错误报告', '崩溃转储 (CrashDumps)', 'safe', true);
  await push(path.join(local, 'Microsoft', 'Windows', 'WER'), '崩溃与错误报告', 'Windows 错误报告 (WER)', 'safe', true);
  await push(path.join(local, 'Microsoft', 'Windows', 'INetCache'), '浏览器/系统缓存', 'IE/系统网络缓存 (INetCache)', 'safe', true);
  await push(path.join(local, 'Microsoft', 'Windows', 'Explorer'), '缩略图与图标缓存', '资源管理器缩略图缓存', 'caution', false);
  await push(path.join(local, 'Microsoft', 'Windows', 'Caches'), '缩略图与图标缓存', 'Windows 缓存', 'caution', false);
  await push(path.join(local, 'D3DSCache'), '着色器缓存', 'DirectX 着色器缓存', 'safe', true);
  await push(path.join(local, 'NVIDIA', 'DXCache'), '着色器缓存', 'NVIDIA 着色器缓存', 'safe', true);
  await push(path.join(local, 'NVIDIA', 'GLCache'), '着色器缓存', 'NVIDIA OpenGL 缓存', 'safe', true);
  await push(path.join(local, 'AMD', 'DxCache'), '着色器缓存', 'AMD 着色器缓存', 'safe', true);
  await push(path.join(local, 'Packages'), '应用包缓存', 'UWP 应用本地缓存 (Packages)', 'expert', false, '包含应用数据，删除后应用需重新登录/下载', 'info');

  if (elevated) {
    await push(path.join(winDir, 'Temp'), '临时文件', '系统临时目录 (C:\\Windows\\Temp)', 'safe', true, undefined, 'trash');
    await push(path.join(winDir, 'SoftwareDistribution', 'Download'), '系统更新', 'Windows 更新下载缓存', 'caution', false, '更新缓存，清空后会自动重建', 'trash');
    await push(path.join(winDir, 'Prefetch'), '系统更新', '预读取缓存 (Prefetch)', 'caution', false, '影响首次启动速度，一般无需清理', 'info');
  } else {
    notes.push('以管理员身份运行可清理 C:\\Windows\\Temp、更新缓存等系统级垃圾。');
  }
  await push(path.join(local, 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache'), '系统更新', '传递优化缓存', 'caution', false, undefined, 'info');
  notes.push('系统盘（C:）中的 WinSxS 组件存储与 Windows.old 请使用「磁盘清理」或 DISM，主程序只做检测报告。');
  return { module: 'windows-system', title: '系统垃圾（Windows）', description: '临时文件、缩略图/着色器缓存、崩溃报告、更新缓存等。', category: 'system', risk: 'safe', supported: true, items, notes, errors: [] };
}

async function linuxScan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const home = ctx.home;
  const dirs: Array<[string, string, 'safe' | 'caution']> = [
    [path.join(home, '.cache'), '用户缓存 (~/.cache)', 'safe'],
    ['/tmp', '系统临时目录 (/tmp)', 'caution'],
    ['/var/tmp', '系统临时目录 (/var/tmp)', 'caution'],
  ];
  for (const [p, label, risk] of dirs) {
    if (!exists(p)) continue;
    const s = await sumSizes([p]);
    if (s.bytes <= 0) continue;
    items.push(mkItem({ module: 'system-junk', category: '系统垃圾', label, path: p, bytes: s.bytes, count: s.count, risk, defaultSelected: risk === 'safe', strategy: 'quarantine' }));
  }
  notes.push('Linux 下部分系统路径需 root 权限。');
  return { module: 'system-junk', title: '系统垃圾（Linux）', description: '缓存与临时文件。', category: 'system', risk: 'safe', supported: true, items, notes, errors: [] };
}

export const systemModule: CleanerModule = {
  id: 'system-junk',
  title: '系统垃圾',
  description: '操作系统缓存、日志、崩溃报告与临时文件。',
  category: 'system',
  risk: 'safe',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  async scan(ctx) {
    if (ctx.platform === 'darwin') return macScan(ctx);
    if (ctx.platform === 'win32') return winScan(ctx);
    return linuxScan(ctx);
  },
};
