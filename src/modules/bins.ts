import path from 'path';
import { mkItem } from './helpers';
import { exists, dirSize, formatBytes } from '../core/util';
import { Vault } from '../core/vault';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * Waste baskets: the OS recycle bin and Master Cleaner's own Vault. Also reports
 * how much the Vault is holding so users know they can reclaim it.
 */

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];

  if (ctx.platform === 'darwin') {
    const trash = path.join(ctx.home, '.Trash');
    if (exists(trash)) {
      const bytes = (await dirSize(trash)).bytes;
      items.push(mkItem({ module: 'trash-bins', category: '废纸篓', label: '系统废纸篓 (~/.Trash)', path: trash, bytes, risk: 'caution', defaultSelected: false, strategy: 'delete', detail: '清空后不可恢复（会永久删除其中的文件）' }));
    }
  } else if (ctx.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(ctx.home, 'AppData', 'Local');
    items.push(mkItem({ module: 'trash-bins', category: '回收站', label: 'Windows 回收站（清空）', command: 'powershell -NoProfile -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"', kind: 'command', bytes: 0, risk: 'caution', defaultSelected: false, strategy: 'exec', detail: '执行后永久删除回收站中的文件' }));
    void local;
  } else {
    const trash = path.join(ctx.home, '.local', 'share', 'Trash');
    if (exists(trash)) {
      const bytes = (await dirSize(trash)).bytes;
      items.push(mkItem({ module: 'trash-bins', category: '回收站', label: '用户回收站', path: trash, bytes, risk: 'caution', defaultSelected: false, strategy: 'delete' }));
    }
  }

  try {
    const vault = new Vault();
    const bytes = await vault.totalBytes();
    const runs = await vault.runs();
    items.push(
      mkItem({
        module: 'trash-bins',
        category: 'Master Cleaner 回收站',
        label: `安全回收站（${runs.length} 次清理记录）`,
        bytes,
        kind: 'info',
        risk: 'safe',
        defaultSelected: false,
        strategy: 'info',
        detail: `已存放 ${formatBytes(bytes)}，可用 \`mc restore <记录ID>\` 还原，或 \`mc vault purge --older-than 30\` 清理 30 天前的记录。`,
      }),
    );
  } catch (e) {
    errors.push(String(e));
  }

  notes.push('系统废纸篓清空为永久删除；Master Cleaner 的「安全回收站」默认保留 30 天，可随时还原。');
  return { module: 'trash-bins', title: '废纸篓与回收站', description: '系统回收站与 Master Cleaner 可还原回收站。', category: 'system', risk: 'caution', supported: true, items, notes, errors };
}

export const binsModule: CleanerModule = {
  id: 'trash-bins',
  title: '废纸篓与回收站',
  description: '系统回收站与安全回收站内容。',
  category: 'system',
  risk: 'caution',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan,
};
