import path from 'path';
import { mkItem } from './helpers';
import { exists, dirSize, formatBytes, runCmd } from '../core/util';
import { isElevated } from '../core/platform';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/** Windows-specific big-but-dangerous items: reported with guidance, not auto-cleaned. */
async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const winDir = process.env.SystemRoot || 'C:\\Windows';
  const systemDrive = (process.env.SystemDrive || 'C:') + path.sep;

  const report = (p: string, category: string, label: string, detail: string) => {
    if (!exists(p)) return;
    items.push(mkItem({ module: 'windows-system', category, label, path: p, bytes: 0, kind: 'info', risk: 'expert', defaultSelected: false, strategy: 'info', detail }));
  };

  report(path.join(winDir, 'WinSxS'), '系统组件存储', 'WinSxS 组件存储', '请使用管理员命令 `Dism /Online /Cleanup-Image /StartComponentCleanup` 安全清理，切勿手动删除');
  report(path.join(systemDrive, 'Windows.old'), '旧系统文件', 'Windows.old', '升级残留，可在「磁盘清理 > 以前的 Windows 安装」中删除');
  report(path.join(winDir, 'MEMORY.DMP'), '内存转储', '内存转储 MEMORY.DMP', '蓝屏转储文件，可在「系统属性 > 高级 > 启动和故障恢复」中关闭或删除');
  report(path.join(winDir, 'Minidump'), '内存转储', '小内存转储 Minidump', '蓝屏小转储，可安全删除（需管理员）');

  for (const f of ['hiberfil.sys', 'pagefile.sys', 'swapfile.sys']) {
    const p = path.join(systemDrive, f);
    if (exists(p)) {
      let bytes = 0;
      try {
        bytes = (await dirSize(p)).bytes;
      } catch {
        bytes = 0;
      }
      items.push(mkItem({ module: 'windows-system', category: '系统文件', label: `${f}（${formatBytes(bytes)}）`, path: p, bytes, kind: 'info', risk: 'expert', defaultSelected: false, strategy: 'info', detail: f === 'hiberfil.sys' ? '休眠文件，可用管理员命令 `powercfg /h off` 关闭休眠释放空间' : '虚拟内存/交换文件，由系统管理，不建议删除' }));
    }
  }

  // Delivery Optimization / component store stats when elevated.
  const elevated = await isElevated();
  if (!elevated) notes.push('部分系统级清理（WinSxS、更新缓存、系统临时文件）需以管理员身份运行。');
  const dism = await runCmd('dism', ['/Online', '/Cleanup-Image', '/AnalyzeComponentStore'], { timeoutMs: 60000 });
  if (dism.ok) {
    const reclaimable = dism.stdout.split('\n').find((l) => /reclaimable|可回收/i.test(l));
    if (reclaimable) notes.push(`组件存储分析：${reclaimable.trim()}`);
  }

  notes.push('Windows 系统级瘦身建议优先使用系统自带「磁盘清理」与 DISM；本工具提供安全的一键用户级清理。');
  return { module: 'windows-system', title: 'Windows 系统文件', description: 'WinSxS、Windows.old、内存转储、休眠/页面文件等大件检测。', category: 'windows', risk: 'expert', supported: true, items, notes, errors };
}

export const windowsModule: CleanerModule = {
  id: 'windows-system',
  title: 'Windows 系统文件',
  description: 'WinSxS、更新缓存、休眠/页面文件等系统级占用检测与指引。',
  category: 'windows',
  risk: 'expert',
  platforms: ['win32'],
  defaultEnabled: true,
  scan,
};
