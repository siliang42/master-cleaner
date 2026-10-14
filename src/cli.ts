#!/usr/bin/env node
import path from 'path';
import os from 'os';
import readline from 'readline';
import { runScan, runClean, allModules, loadConfig, saveConfig, moduleById, overallDisk } from './core/engine';
import { ScheduleStore, nextRun, describeCron, installLaunchd, removeLaunchd, windowsSchtasks, crontabLine, launchdPath } from './core/scheduler';
import { Vault } from './core/vault';
import { osLabel, isElevated, diskUsage } from './core/platform';
import { formatBytes, humanAge, runCmd } from './core/util';
import { dataDir, vaultDir, logPath } from './core/paths';
import type { CandidateItem, ScanReport } from './core/types';
import { LEGAL, copyrightLine, licenseBanner, legalText } from './core/legal';
import { localize, t, setLocale, normalizeLocale } from './i18n';

const VERSION = LEGAL.version;

interface Flags {
  _: string[];
  [key: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (a.includes('=')) {
        const [k, v] = key.split('=');
        flags[k] = v;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else flags[key] = true;
      }
    } else if (a.startsWith('-')) {
      flags[a.slice(1)] = true;
    } else flags._.push(a);
  }
  return flags;
}

function parseSize(s: string | boolean | string[] | undefined): number | undefined {
  if (typeof s !== 'string') return undefined;
  const m = s.trim().match(/^([\d.]+)\s*([kmgt]?b?)$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'b').toLowerCase();
  const mult: Record<string, number> = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3, t: 1024 ** 4, tb: 1024 ** 4 };
  return Math.round(n * (mult[unit] ?? 1));
}

function listModules(flag: string | boolean | string[] | undefined): string[] | undefined {
  if (typeof flag !== 'string') return undefined;
  return flag.split(',').map((s) => s.trim()).filter(Boolean);
}

function bar(bytes: number, total: number, width = 20): string {
  if (total <= 0) return ' '.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((bytes / total) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function printReport(report: ScanReport): void {
  console.log('');
  console.log(` ${localize('磁盘')}      ${localize('可回收')} ${formatBytes(report.reclaimableBytes)} · ${localize('仅统计')} ${formatBytes(report.reportOnlyBytes)} · ${report.totalItems} ${localize('项')} (${localize('默认可选')} ${formatBytes(report.selectedBytes)})`);
  for (const m of report.modules) {
    const items = [...m.items].sort((a, b) => b.bytes - a.bytes);
    const total = items.filter((i) => !i.duplicate && i.strategy !== 'info').reduce((a, i) => a + i.bytes, 0);
    if (!items.length && !m.notes.length) continue;
    console.log('');
    console.log(`▶ ${localize(m.title)}  ${m.supported ? '' : localize('(当前平台不支持)')}  ${formatBytes(total)}`);
    for (const it of items.slice(0, 25)) {
      const mark = it.strategy === 'info' ? '·' : it.defaultSelected ? '☑' : '☐';
      const risk = it.risk === 'safe' ? '' : it.risk === 'caution' ? ' (' + localize('谨慎') + ')' : ' (' + localize('专家') + ')';
      console.log(`   ${mark} ${bar(it.bytes, Math.max(1, items[0]?.bytes ?? 1), 12)} ${formatBytes(it.bytes).padStart(9)}  ${localize(it.label)}${risk}`);
    }
    if (items.length > 25) console.log(`   ... ${localize('其余')} ${items.length - 25}`);
    for (const n of m.notes) console.log(`   ℹ ${localize(n)}`);
  }
  if (report.errors.length) {
    console.log('');
    console.log('⚠ ' + localize('部分模块出错') + ':');
    for (const e of report.errors) console.log(`   ${e}`);
  }
  console.log('');
}

async function cmdScan(flags: Flags): Promise<void> {
  const cfg = await loadConfig();
  const modules = listModules(flags.modules);
  const opts = {
    roots: listModules(flags.roots),
    includeExpert: !!flags['include-expert'] || cfg.includeExpert,
    includeInfo: flags.info === undefined ? cfg.includeInfo : !!flags.info,
    minLargeBytes: parseSize(flags['min-large']),
    minAgeDays: flags['min-age'] ? parseInt(String(flags['min-age']), 10) : undefined,
    maxDepth: flags.deep ? 20 : 14,
  };
  const report = await runScan({ moduleIds: modules, opts, log: flags.quiet ? undefined : (m) => process.stderr.write(`  ${m}\r`) });
  if (flags.quiet) process.stderr.write('\r');
  if (flags.json) {
    const out = JSON.stringify(report, null, 2);
    if (typeof flags.save === 'string') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('fs').writeFileSync(flags.save, out);
      console.log(`${localize('已保存扫描报告到')} ${flags.save}`);
    } else console.log(out);
    return;
  }
  printReport(report);
  if (typeof flags.save === 'string') {
    require('fs').writeFileSync(flags.save, JSON.stringify(report, null, 2));
    console.log(`已保存扫描报告到 ${flags.save}`);
  }
}

function selectItems(report: ScanReport, flags: Flags): CandidateItem[] {
  const all = report.modules.flatMap((m) => m.items);
  if (flags['select-all']) return all.filter((i) => i.strategy !== 'info');
  if (typeof flags.only === 'string') {
    const ids = new Set(flags.only.split(',').map((s) => s.trim()));
    return all.filter((i) => ids.has(i.id) || ids.has(i.module));
  }
  return all.filter((i) => i.defaultSelected && i.strategy !== 'info');
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => {
    rl.close();
    resolve(/^y(es)?$/i.test(ans.trim()));
  }));
}

async function cmdClean(flags: Flags): Promise<void> {
  const cfg = await loadConfig();
  const modules = listModules(flags.modules);
  const report = await runScan({
    moduleIds: modules,
    opts: {
      includeExpert: !!flags['include-expert'] || cfg.includeExpert,
      includeInfo: false,
      minLargeBytes: parseSize(flags['min-large']),
      roots: listModules(flags.roots),
      maxDepth: flags.deep ? 20 : 14,
    },
    log: flags.quiet ? undefined : (m) => process.stderr.write(`  ${m}\r`),
  });
  const items = selectItems(report, flags);
  if (!items.length) {
    console.log(localize('没有需要清理的项目。'));
    return;
  }
  const total = items.reduce((a, i) => a + i.bytes, 0);
  console.log(`\n${localize('将清理')} ${items.length} ${localize('项')}, ${localize('预计释放')} ${formatBytes(total)}:`);
  for (const it of items.slice(0, 40)) console.log(`  · ${formatBytes(it.bytes).padStart(9)}  ${localize(it.label)}${it.risk !== 'safe' ? ` [${it.risk}]` : ''}`);
  if (items.length > 40) console.log(`  ... ${localize('其余')} ${items.length - 40}`);

  const dryRun = !!flags['dry-run'];
  const mode = (typeof flags.mode === 'string' ? flags.mode : 'quarantine') as 'quarantine' | 'trash' | 'delete';
  if (!dryRun && !flags.yes) {
    const ok = await confirm(`\n${localize('模式')}: ${mode}. ${localize('确认执行？')} (y/N) `);
    if (!ok) {
      console.log(localize('已取消。'));
      return;
    }
  }
  const { record, skipped } = await runClean(items, { mode, dryRun, log: (m) => console.log(`  ${m}`) });
  console.log('');
  console.log(dryRun ? localize('（演练模式，未实际删除）') : localize('清理完成'));
  console.log(`  ${localize('释放：')}${formatBytes(record.bytes)}  ${localize('处理：')}${record.removed} ${localize('项')}  ${localize('记录ID：')}${record.id}`);
  if (record.errors.length) {
    console.log(`  ${localize('错误')} ${record.errors.length}:`);
    for (const e of record.errors.slice(0, 10)) console.log(`   ! ${e}`);
  }
  if (skipped.length) {
    console.log(`  ${localize('出于安全跳过')} ${skipped.length} ${localize('项')}:`);
    for (const s of skipped.slice(0, 10)) console.log(`   - ${s.label}: ${s.reason}`);
  }
  if (mode === 'quarantine' && !dryRun) console.log(`  ${localize('可用')} \`mc restore ${record.id}\` ${localize('还原。')}`);
}

async function cmdRun(flags: Flags): Promise<void> {
  const id = flags._[0];
  const store = new ScheduleStore();
  const list = await store.list();
  const s = list.find((x) => x.id === id);
  if (!s) {
    console.error(`${localize('未找到计划任务')} ${id}`);
    process.exit(1);
  }
  const report = await runScan({ moduleIds: s.moduleIds, opts: { includeExpert: false, includeInfo: false } });
  const items = report.modules.flatMap((m) => m.items).filter((i) => i.defaultSelected && i.strategy !== 'info');
  const { record } = await runClean(items, { mode: s.mode });
  await store.markRun(s.id, { bytes: record.bytes, removed: record.removed, at: Date.now(), errors: record.errors.length });
  console.log(`[${new Date().toISOString()}] ${localize('计划')} ${s.name} ${localize('完成：释放')} ${formatBytes(record.bytes)}, ${record.removed} ${localize('项')}`);
}

async function cmdSchedule(flags: Flags): Promise<void> {
  const action = flags._[0] || 'list';
  const store = new ScheduleStore();
  if (action === 'list') {
    const list = await store.list();
    if (!list.length) {
      console.log(`${localize('暂无定时任务。')} mc schedule add --name X --cron "0 3 * * *" --modules ai,dev,system`);
      return;
    }
    for (const s of list) {
      const nr = nextRun(s.cron);
      console.log(`${s.enabled ? '●' : '○'} ${s.id}  ${s.name}`);
      console.log(`    cron ${s.cron} (${localize(describeCron(s.cron))})  ${localize('模块')} ${s.moduleIds.join(',')}  ${localize('模式')} ${s.mode}`);
      console.log(`    ${localize('下次')} ${nr ? new Date(nr).toLocaleString() : '—'}  ${localize('上次')} ${s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() + ` (${formatBytes(s.lastResult?.bytes ?? 0)})` : '—'}`);
    }
    return;
  }
  if (action === 'add') {
    const cron = String(flags.cron || '0 3 * * *');
    const name = String(flags.name || '定时清理');
    const modules = listModules(flags.modules) || ['ai-residue', 'dev-caches', 'system-junk'];
    const mode = (typeof flags.mode === 'string' ? flags.mode : 'quarantine') as 'quarantine' | 'trash' | 'delete';
    const id = `sched-${Date.now().toString(36)}`;
    const s = await store.add({ id, name, cron, moduleIds: modules, mode, enabled: true });
    const nr = nextRun(s.cron);
    console.log(`${localize('已创建')} ${s.id}: ${name}, cron ${cron} (${localize(describeCron(cron))}), ${localize('下次')} ${nr ? new Date(nr).toLocaleString() : '—'}`);
    console.log(`${localize('提示：用')} \`mc daemon\` ${localize('常驻执行')}, ${localize('或')} \`mc schedule install ${s.id}\` ${localize('交给系统计划任务')}`);
    return;
  }
  if (action === 'remove') {
    const id = flags._[1];
    const ok = await store.remove(id);
    await removeLaunchd(id).catch(() => undefined);
    console.log(ok ? `${localize('已删除')} ${id}` : `${localize('未找到')} ${id}`);
    return;
  }
  if (action === 'enable' || action === 'disable') {
    const id = flags._[1];
    const s = await store.setEnabled(id, action === 'enable');
    console.log(s ? `${action === 'enable' ? localize('启用') : localize('停用')} ${id}` : `${localize('未找到')} ${id}`);
    return;
  }
  if (action === 'install') {
    const id = flags._[1];
    const s = (await store.list()).find((x) => x.id === id);
    if (!s) return void console.error(`未找到 ${id}`);
    const nodeBin = process.execPath;
    const cliPath = path.resolve(__filename.replace(/\.ts$/, '.js'));
    if (process.platform === 'darwin') {
      const p = await installLaunchd(s, nodeBin, cliPath);
      console.log(`${localize('已写入')} ${p}\n${localize('执行以下命令加载：')}\n  launchctl load ${p}`);
    } else if (process.platform === 'win32') {
      console.log(localize('在管理员 PowerShell 中执行：') + '\n  ' + windowsSchtasks(s, nodeBin, cliPath));
    } else {
      console.log(localize('添加到 crontab（crontab -e）：') + '\n  ' + crontabLine(s, nodeBin, cliPath));
    }
    return;
  }
  if (action === 'uninstall') {
    const id = flags._[1];
    if (process.platform === 'darwin') {
      console.log(`${localize('执行：')} launchctl unload ${launchdPath(id)} && rm ${launchdPath(id)}`);
      await removeLaunchd(id);
    }
    return;
  }
  console.error(`${localize('未知 schedule 子命令')}: ${action} (list/add/remove/enable/disable/install/uninstall)`);
}

async function cmdDaemon(): Promise<void> {
  const store = new ScheduleStore();
  console.log(localize('Master Cleaner 守护进程已启动，每 30 秒检查一次计划任务。'));
  const fired = new Set<string>();
  const tick = async () => {
    const list = await store.list();
    const now = Date.now();
    for (const s of list) {
      if (!s.enabled) continue;
      const nr = nextRun(s.cron, s.lastRunAt ?? 0);
      if (nr !== null && nr <= now) {
        const key = `${s.id}@${Math.floor(nr / 60000)}`;
        if (fired.has(key)) continue;
        fired.add(key);
        console.log(`[${new Date().toLocaleString()}] ${localize('触发计划：')}${s.name}`);
        try {
          const report = await runScan({ moduleIds: s.moduleIds, opts: { includeInfo: false } });
          const items = report.modules.flatMap((m) => m.items).filter((i) => i.defaultSelected && i.strategy !== 'info');
          const { record } = await runClean(items, { mode: s.mode });
          await store.markRun(s.id, { bytes: record.bytes, removed: record.removed, at: now, errors: record.errors.length });
          console.log(`  → ${localize('释放')} ${formatBytes(record.bytes)}, ${record.removed} ${localize('项')}`);
        } catch (e) {
          console.log(`  ! ${localize('失败：')}${String(e)}`);
        }
      }
    }
  };
  setInterval(() => void tick(), 30000);
  await tick();
}

async function cmdRestore(flags: Flags): Promise<void> {
  const vault = new Vault();
  const id = flags._[0];
  if (!id) {
    const runs = await vault.runs();
    if (!runs.length) return void console.log(localize('回收站为空。'));
    console.log(localize('可还原的清理记录：'));
    for (const r of runs) console.log(`  ${localize(vault.summary(r))}`);
    console.log(`\n${localize('用法：')}mc restore <record-id>`);
    return;
  }
  const res = await vault.restore(id);
  console.log(`${localize('已还原')} ${res.restored} ${localize('项。')}`);
  for (const e of res.errors.slice(0, 10)) console.log(`  ! ${e}`);
}

async function cmdVault(flags: Flags): Promise<void> {
  const action = flags._[0] || 'list';
  const vault = new Vault();
  if (action === 'purge') {
    if (typeof flags['older-than'] === 'string') {
      const days = parseInt(flags['older-than'], 10);
      const bytes = await vault.purgeOlderThan(days);
      console.log(`${localize('已清理')} ${days} ${localize('天前的回收记录，释放')} ${formatBytes(bytes)}.`);
    } else {
      const bytes = await vault.purgeAll();
      console.log(`${localize('已清空回收站，释放')} ${formatBytes(bytes)}.`);
    }
    return;
  }
  const runs = await vault.runs();
  console.log(`${localize('回收站：')}${formatBytes(await vault.totalBytes())}, ${runs.length} ${localize('条记录')}.`);
  for (const r of runs) console.log(`  ${localize(vault.summary(r))}`);
}

async function cmdStatus(): Promise<void> {
  const d = diskUsage(os.homedir());
  const vault = new Vault();
  const store = new ScheduleStore();
  const list = await store.list();
  console.log('Master Cleaner', VERSION);
  console.log(`  ${localize('系统')}      ${osLabel()} (${process.arch})`);
  console.log(`  ${localize('磁盘')}      ${d.path}  ${localize('已用')} ${formatBytes(d.used)} / ${formatBytes(d.total)}  ${localize('可用')} ${formatBytes(d.free)}`);
  console.log(`  ${localize('回收站')}    ${formatBytes(await vault.totalBytes())} (${(await vault.runs()).length} ${localize('条记录')})`);
  console.log(`  ${localize('定时任务')} ${list.filter((s) => s.enabled).length}/${list.length} ${localize('启用')}`);
  console.log(`  ${localize('数据目录')} ${dataDir()}`);
}

async function cmdDoctor(): Promise<void> {
  console.log(`Master Cleaner ${localize('自检')}`);
  console.log(`  Node     ${process.version}`);
  console.log(`  ${localize('平台')}     ${osLabel()} ${process.arch}`);
  console.log(`  ${localize('管理员')}   ${(await isElevated()) ? localize('是') : localize('否')}`);
  console.log(`  ${localize('模块')}     ${allModules().length}`);
  const cfg = await loadConfig();
  console.log(`  ${localize('配置')}     ${JSON.stringify(cfg)}`);
  for (const tool of ['docker', 'podman', 'brew', 'git', 'node', 'npm']) {
    const r = await runCmd(process.platform === 'win32' ? 'where' : 'which', [tool]);
    console.log(`  ${tool.padEnd(8)} ${r.ok ? r.stdout.split('\n')[0] : localize('未检测到')}`);
  }
  console.log(`  ${localize('日志')}     ${logPath()}`);
}

function cmdModules(): void {
  for (const m of allModules()) {
    const supported = m.platforms.includes(process.platform) ? '✔' : '·';
    console.log(`${supported} ${m.id.padEnd(16)} ${m.category.padEnd(12)} ${localize('风险')}:${m.risk.padEnd(7)} ${localize(m.title)}`);
    console.log(`   ${localize(m.description)}`);
  }
}

async function cmdServe(flags: Flags): Promise<void> {
  const { startServer } = await import('./server');
  const port = flags.port ? parseInt(String(flags.port), 10) : 43110;
  await startServer(port, !flags.nostdin);
}

function help(): void {
  console.log(t('cli.help', { version: VERSION }));
  console.log('');
  console.log(licenseBanner());
  console.log(copyrightLine());
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = parseArgs(argv);
  if (typeof flags.lang === 'string') setLocale(normalizeLocale(flags.lang));
  if (flags.version || flags.v) {
    console.log(`${licenseBanner()}\n${copyrightLine()}`);
    return;
  }
  if (flags.legal) {
    console.log(legalText());
    return;
  }
  const [cmdRaw, ...rest] = flags._;
  flags._ = rest;
  const cmd = cmdRaw || (argv[0] === '--help' || argv[0] === '-h' ? 'help' : undefined);
  try {
    switch (cmd) {
      case 'scan': return void (await cmdScan(flags));
      case 'clean': return void (await cmdClean(flags));
      case 'run': return void (await cmdRun(flags));
      case 'schedule': return void (await cmdSchedule(flags));
      case 'daemon': return void (await cmdDaemon());
      case 'restore': return void (await cmdRestore(flags));
      case 'vault': return void (await cmdVault(flags));
      case 'serve': return void (await cmdServe(flags));
      case 'status': return void (await cmdStatus());
      case 'doctor': return void (await cmdDoctor());
      case 'modules': return void cmdModules();
      case 'legal': case '--legal': return void console.log(legalText());
      case 'version': case '--version': return void console.log(`${licenseBanner()}\n${copyrightLine()}`);
      default: return void help();
    }
  } catch (e) {
    console.error(localize('错误') + ':', e instanceof Error ? e.stack : String(e));
    process.exit(1);
  }
}

void main();
