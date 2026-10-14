import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { schedulesPath, dataDir } from './paths';
import { readJson, writeJson, ensureDir } from './util';
import type { CleanMode } from './engine';

/**
 * A tiny dependency-free cron engine (5 fields: min hour dom month dow) plus a
 * persistent schedule store and OS-level integration helpers, so cleaning can
 * run unattended via the built-in daemon *or* the native task scheduler.
 */

const FIELDS = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'] as const;

export interface CronField {
  raw: string;
  values: Set<number>;
  isWildcard: boolean;
}

export interface ParsedCron {
  fields: CronField[];
}

function range(min: number, max: number): number[] {
  const out: number[] = [];
  for (let i = min; i <= max; i++) out.push(i);
  return out;
}

const BOUNDS: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
];

function parseField(raw: string, idx: number): CronField {
  const { min, max } = BOUNDS[idx];
  const values = new Set<number>();
  const isWildcard = raw === '*';
  for (const part of raw.split(',')) {
    let step = 1;
    let body = part;
    if (part.includes('/')) {
      const [b, s] = part.split('/');
      body = b;
      step = parseInt(s, 10);
      if (!Number.isFinite(step) || step <= 0) throw new Error(`非法步长：${part}`);
    }
    let lo = min;
    let hi = max;
    if (body !== '*' && body !== '') {
      if (body.includes('-')) {
        const [a, b] = body.split('-');
        lo = parseInt(a, 10);
        hi = parseInt(b, 10);
      } else {
        lo = parseInt(body, 10);
        hi = lo;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`非法字段：${raw}`);
    for (let v = lo; v <= hi; v += step) {
      let value = v;
      if (idx === 4 && value === 7) value = 0; // 7 = Sunday
      if (value >= min && value <= max) values.add(value);
    }
  }
  if (values.size === 0) throw new Error(`字段无有效取值：${raw}`);
  return { raw, values, isWildcard };
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron 需为 5 个字段：分 时 日 月 周');
  return { fields: parts.map((p, i) => parseField(p, i)) };
}

function matches(parsed: ParsedCron, d: Date): boolean {
  const [min, hour, dom, mon, dow] = parsed.fields;
  if (!min.values.has(d.getMinutes())) return false;
  if (!hour.values.has(d.getHours())) return false;
  if (!mon.values.has(d.getMonth() + 1)) return false;
  if (!dow.values.has(d.getDay())) return false;
  // Standard cron rule: when both dom and dow are restricted, either may match.
  if (!dom.isWildcard && !dow.isWildcard) return true;
  return dom.values.has(d.getDate());
}

/** Next fire time strictly after `from`. Searches up to ~366 days. */
export function nextRun(expr: string, from = Date.now()): number | null {
  const parsed = parseCron(expr);
  const start = new Date(from);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const d = new Date(start.getTime() + i * 60000);
    if (matches(parsed, d)) return d.getTime();
  }
  return null;
}

export function describeCron(expr: string): string {
  try {
    parseCron(expr);
  } catch (e) {
    return `无效：${String(e)}`;
  }
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
  const parts: string[] = [];
  if (m.startsWith('*/')) parts.push(`每 ${m.slice(2)} 分钟`);
  else if (m === '*') parts.push('每分钟');
  else parts.push(`${m} 分`);
  if (h !== '*') parts.push(`${h} 时`);
  if (dom !== '*') parts.push(`${dom} 日`);
  if (mon !== '*') parts.push(`${mon} 月`);
  if (dow !== '*') parts.push(`周 ${dow}`);
  return parts.join(' ');
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  moduleIds: string[];
  mode: CleanMode;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastResult?: { bytes: number; removed: number; at: number; errors: number };
}

export class ScheduleStore {
  async list(): Promise<Schedule[]> {
    return readJson<Schedule[]>(schedulesPath(), []);
  }

  async saveAll(list: Schedule[]): Promise<void> {
    await writeJson(schedulesPath(), list);
  }

  async add(s: Omit<Schedule, 'createdAt'> & { createdAt?: number }): Promise<Schedule> {
    const list = await this.list();
    const sched: Schedule = { createdAt: Date.now(), ...s, enabled: s.enabled ?? true };
    parseCron(sched.cron); // validate before persisting
    list.push(sched);
    await this.saveAll(list);
    return sched;
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.list();
    const next = list.filter((s) => s.id !== id);
    await this.saveAll(next);
    return next.length !== list.length;
  }

  async setEnabled(id: string, enabled: boolean): Promise<Schedule | undefined> {
    const list = await this.list();
    const s = list.find((x) => x.id === id);
    if (!s) return undefined;
    s.enabled = enabled;
    await this.saveAll(list);
    return s;
  }

  async markRun(id: string, result: Schedule['lastResult']): Promise<void> {
    const list = await this.list();
    const s = list.find((x) => x.id === id);
    if (!s) return;
    s.lastRunAt = result?.at ?? Date.now();
    s.lastResult = result;
    await this.saveAll(list);
  }
}

/* ------------------------- OS-level integration ------------------------- */

export function launchdPlist(s: Schedule, nodeBin: string, cliPath: string): string {
  const [m, h] = s.cron.trim().split(/\s+/);
  const minute = m === '*' ? '*' : Number(m);
  const hour = h === '*' ? '*' : Number(h);
  const calendar = h === '*' ? `<integer>${minute === '*' ? 0 : minute}</integer>` : `<integer>${hour}</integer><integer>${minute === '*' ? 0 : minute}</integer>`;
  const envCP = [
    `<key>PATH</key>`,
    `<string>${path.dirname(nodeBin)}:/usr/bin:/bin:/usr/sbin:/sbin</string>`,
  ].join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mastercleaner.${s.id}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${cliPath}</string>
    <string>run</string>
    <string>${s.id}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    ${envCP}
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>${h === '*' ? 'Minute' : 'Hour'}</key>${calendar}
    ${h === '*' ? '' : `<key>Minute</key><integer>${minute === '*' ? 0 : minute}</integer>`}
  </dict>
  <key>StandardOutPath</key><string>${path.join(dataDir(), `launchd-${s.id}.log`)}</string>
  <key>StandardErrorPath</key><string>${path.join(dataDir(), `launchd-${s.id}.err.log`)}</string>
</dict>
</plist>
`;
}

export function launchdPath(id: string): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `com.mastercleaner.${id}.plist`);
}

export async function installLaunchd(s: Schedule, nodeBin: string, cliPath: string): Promise<string> {
  const p = launchdPath(s.id);
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, launchdPlist(s, nodeBin, cliPath), 'utf8');
  return p;
}

export async function removeLaunchd(id: string): Promise<void> {
  await fsp.rm(launchdPath(id), { force: true }).catch(() => undefined);
}

export function windowsSchtasks(s: Schedule, nodeBin: string, cliPath: string): string {
  const [m, h] = s.cron.trim().split(/\s+/);
  const mm = String(m === '*' ? 0 : Number(m)).padStart(2, '0');
  const hh = String(h === '*' ? 0 : Number(h)).padStart(2, '0');
  const tr = `"${nodeBin}" "${cliPath}" run ${s.id}`;
  return `schtasks /Create /F /SC DAILY /ST ${hh}:${mm} /TN "MasterCleaner\\${s.id}" /TR ${tr}`;
}

export function crontabLine(s: Schedule, nodeBin: string, cliPath: string): string {
  return `${s.cron} "${nodeBin}" "${cliPath}" run ${s.id} # master-cleaner:${s.id}`;
}
