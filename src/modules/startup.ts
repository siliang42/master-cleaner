import path from 'path';
import fs from 'fs';
import { mkItem } from './helpers';
import { exists, dirSize, formatBytes, runCmd } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * Startup inventory (a nod to "boot acceleration" in 360 安全卫士). We do not
 * silently disable anything: we enumerate login items / LaunchAgents / Run keys
 * / scheduled tasks and let the user see what starts automatically.
 */

async function macStartup(ctx: Ctx): Promise<CandidateItem[]> {
  const items: CandidateItem[] = [];
  const userAgents = path.join(ctx.home, 'Library', 'LaunchAgents');
  if (exists(userAgents)) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(userAgents).filter((f) => f.endsWith('.plist'));
    } catch {
      files = [];
    }
    if (files.length) {
      items.push(
        mkItem({
          module: 'startup-items',
          category: '开机启动',
          label: `用户登录项 LaunchAgents（${files.length} 个）`,
          detail: files.slice(0, 20).join('\n'),
          paths: files.map((f) => path.join(userAgents, f)),
          kind: 'group',
          bytes: 0,
          count: files.length,
          risk: 'caution',
          defaultSelected: false,
          strategy: 'info',
          meta: { note: '可在「系统设置 > 通用 > 登录项」或 launchctl 中管理' },
        }),
      );
    }
  }
  // Login items (best effort; may require Automation permission).
  const r = await runCmd('osascript', ['-e', 'tell application "System Events" to get the name of every login item'], { timeoutMs: 8000 });
  if (r.ok && r.stdout.trim()) {
    const names = r.stdout.split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length)
      items.push(mkItem({ module: 'startup-items', category: '开机启动', label: `登录项（${names.length} 个）`, detail: names.join('\n'), kind: 'info', bytes: 0, count: names.length, risk: 'safe', defaultSelected: false, strategy: 'info' }));
  }
  const sysDirs = ['/Library/LaunchAgents', '/Library/LaunchDaemons'];
  for (const d of sysDirs) {
    if (!exists(d)) continue;
    let n = 0;
    try {
      n = fs.readdirSync(d).filter((f) => f.endsWith('.plist')).length;
    } catch {
      n = 0;
    }
    items.push(mkItem({ module: 'startup-items', category: '开机启动', label: `系统级 ${path.basename(d)}（${n} 个，需管理员）`, detail: d, kind: 'info', bytes: 0, count: n, risk: 'safe', defaultSelected: false, strategy: 'info' }));
  }
  return items;
}

async function winStartup(ctx: Ctx): Promise<CandidateItem[]> {
  const items: CandidateItem[] = [];
  const runKeys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  ];
  for (const key of runKeys) {
    const r = await runCmd('reg', ['query', key], { timeoutMs: 8000 });
    if (r.ok && r.stdout.trim()) {
      const lines = r.stdout.split('\n').filter((l) => l.includes('REG_'));
      items.push(mkItem({ module: 'startup-items', category: '开机启动', label: `注册表启动项 ${key.split('\\').slice(-1)[0]}（${lines.length} 项）`, detail: lines.slice(0, 20).join('\n'), kind: 'info', bytes: 0, count: lines.length, risk: 'caution', defaultSelected: false, strategy: 'info' }));
    }
  }
  const startupFolder = path.join(process.env.APPDATA || path.join(ctx.home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  if (exists(startupFolder)) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(startupFolder);
    } catch {
      files = [];
    }
    if (files.length)
      items.push(mkItem({ module: 'startup-items', category: '开机启动', label: `启动文件夹（${files.length} 项）`, detail: files.join('\n'), paths: files.map((f) => path.join(startupFolder, f)), kind: 'group', bytes: 0, count: files.length, risk: 'caution', defaultSelected: false, strategy: 'info' }));
  }
  const st = await runCmd('schtasks', ['/query', '/fo', 'csv', '/nh'], { timeoutMs: 12000 });
  if (st.ok) {
    const lines = st.stdout.split('\n').filter((l) => l.trim());
    items.push(mkItem({ module: 'startup-items', category: '计划任务', label: `计划任务（${lines.length} 个）`, detail: lines.slice(0, 25).join('\n'), kind: 'info', bytes: 0, count: lines.length, risk: 'safe', defaultSelected: false, strategy: 'info' }));
  }
  return items;
}

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items = ctx.platform === 'darwin' ? await macStartup(ctx) : ctx.platform === 'win32' ? await winStartup(ctx) : [];
  const notes = ['开机启动项仅做盘点，不自动禁用；请在系统设置中按需关闭。'];
  return { module: 'startup-items', title: '开机启动项', description: '登录项、LaunchAgents、注册表启动项与计划任务盘点。', category: 'startup', risk: 'safe', supported: ctx.platform === 'darwin' || ctx.platform === 'win32', items, notes, errors: [] };
}

export const startupModule: CleanerModule = {
  id: 'startup-items',
  title: '开机启动项',
  description: '盘点开机自动启动的项目（不自动禁用）。',
  category: 'startup',
  risk: 'safe',
  platforms: ['darwin', 'win32'],
  defaultEnabled: true,
  scan,
};
