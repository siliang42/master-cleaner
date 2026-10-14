import path from 'path';
import fs from 'fs';
import { mkItem, sumSizes } from './helpers';
import { exists, dirSize, formatBytes, runCmd, collectFiles } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/** macOS-specific residue that generic cleaners miss. */
async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];

  // .DS_Store litter (native find is far faster than a full tree walk)
  try {
    const prune = ['Library', '.git', 'node_modules', '.Trash', '.cache', '.npm', '.pnpm-store', '.venv', 'venv', 'DerivedData'];
    const pruneExpr = prune.flatMap((n) => ['-o', '-name', n]);
    const r = await runCmd('find', [ctx.home, '-maxdepth', '5', '(', ...pruneExpr.slice(1), ')', '-prune', '-o', '-name', '.DS_Store', '-print'], { timeoutMs: 20000 });
    const dsPaths = r.stdout.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 3000);
    const dsStores: Array<{ path: string; size: number }> = [];
    for (const p of dsPaths) {
      try { dsStores.push({ path: p, size: fs.lstatSync(p).size }); } catch { /* ignore */ }
    }
    if (dsStores.length) {
      const bytes = dsStores.reduce((a, f) => a + f.size, 0);
      items.push(
        mkItem({
          module: 'macos-system',
          category: 'Finder 残留',
          label: `.DS_Store 文件（${dsStores.length} 个）`,
          detail: 'Finder 在每个文件夹生成的视图配置，删除后会自动重建',
          paths: dsStores.map((f) => f.path),
          kind: 'group',
          bytes,
          count: dsStores.length,
          risk: 'safe',
          defaultSelected: true,
          strategy: 'delete',
        }),
      );
    }
  } catch (e) {
    errors.push(String(e));
  }

  // iOS / iPadOS device backups (valuable!)
  const backups = path.join(ctx.home, 'Library', 'Application Support', 'MobileSync', 'Backup');
  if (exists(backups)) {
    const du = await runCmd('du', ['-sk', backups], { timeoutMs: 20000 });
    const mm = du.stdout.match(/^(\d+)/);
    const bytes = mm ? parseInt(mm[1], 10) * 1024 : 0;
    items.push(
      mkItem({
        module: 'macos-system',
        category: 'iOS 备份',
        label: 'iPhone / iPad 本机备份',
        path: backups,
        bytes,
        risk: 'expert',
        defaultSelected: false,
        strategy: 'info',
        detail: '手机备份含照片与聊天记录，删除后无法找回；请在「访达 > 设备」中管理',
      }),
    );
  }

  // Time Machine local snapshots
  const tm = await runCmd('tmutil', ['listlocalsnapshots', '/'], { timeoutMs: 10000 });
  if (tm.ok) {
    const lines = tm.stdout.split('\n').filter((l) => l.includes('com.apple.TimeMachine'));
    if (lines.length)
      items.push(
        mkItem({
          module: 'macos-system',
          category: '系统快照',
          label: `Time Machine 本地快照（${lines.length} 个）`,
          detail: '本地快照会随磁盘压力自动回收；如确需可执行 `sudo tmutil deletelocalsnapshots <日期>`',
          kind: 'info',
          bytes: 0,
          count: lines.length,
          risk: 'expert',
          defaultSelected: false,
          strategy: 'info',
        }),
      );
  }

  // Spotlight index (report)
  if (exists('/.Spotlight-V100'))
    items.push(mkItem({ module: 'macos-system', category: '系统索引', label: 'Spotlight 索引（需管理员）', path: '/.Spotlight-V100', bytes: 0, kind: 'info', risk: 'expert', defaultSelected: false, strategy: 'info', detail: '用 `sudo mdutil -E /` 重建索引，一般无需清理' }));

  notes.push('macOS 系统完整性保护（SIP）保护的路径不会被清理；系统资产与 Apple Intelligence 模型仅做统计。');
  return { module: 'macos-system', title: 'macOS 系统残留', description: '.DS_Store、设备备份、本地快照与系统索引。', category: 'macos', risk: 'safe', supported: true, items, notes, errors };
}

export const macosModule: CleanerModule = {
  id: 'macos-system',
  title: 'macOS 系统残留',
  description: 'Finder 残留、iOS 备份、本地快照等 macOS 专有内容。',
  category: 'macos',
  risk: 'safe',
  platforms: ['darwin'],
  defaultEnabled: true,
  scan,
};
