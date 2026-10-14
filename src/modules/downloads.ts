import path from 'path';
import { mkItem } from './helpers';
import { collectFiles, formatBytes, humanAge } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * Downloads & Desktop tidy-up. Surfaces large/old files sitting in the two
 * folders everyone forgets about, without ever touching recent work.
 */

const MAX_ITEMS = 40;

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const ageDays = ctx.opts.minAgeDays || 90;
  const olderThanMs = ageDays * 86400000;
  const roots = [path.join(ctx.home, 'Downloads'), path.join(ctx.home, 'Desktop')];

  for (const root of roots) {
    try {
      const found = await collectFiles(root, { maxDepth: 3, minBytes: 10 * 1024 * 1024, olderThanMs, now: ctx.opts.now, skipDirs: ['node_modules', '.git', '.app', 'Library'] });
      found.sort((a, b) => b.size - a.size);
      for (const f of found.slice(0, MAX_ITEMS)) {
        items.push(
          mkItem({
            module: 'downloads-desk',
            category: `${path.basename(root)} 旧文件`,
            label: `${formatBytes(f.size)}  ${path.basename(f.path)}`,
            detail: `${f.path}\n最后修改 ${humanAge(f.mtimeMs, ctx.opts.now)}`,
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
    } catch (e) {
      errors.push(`${root}: ${String(e)}`);
    }
  }
  notes.push(`列出下载/桌面中大于 10MB 且超过 ${ageDays} 天未修改的文件，默认不勾选，清理方式为移入回收站。`);
  return { module: 'downloads-desk', title: '下载与桌面', description: '久未清理的下载与桌面大文件。', category: 'downloads', risk: 'caution', supported: true, items, notes, errors };
}

export const downloadsModule: CleanerModule = {
  id: 'downloads-desk',
  title: '下载与桌面',
  description: '整理下载与桌面中堆积的大文件。',
  category: 'downloads',
  risk: 'caution',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan,
};
