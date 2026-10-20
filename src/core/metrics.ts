import os from 'os';
import fsp from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { diskUsage } from './platform';

const pexec = promisify(execFile);

let lastTimes = os.cpus().map((c) => ({ ...c.times }));

/** CPU utilisation sampled over a short window, 0-100. */
export async function cpuUsage(): Promise<number> {
  await new Promise((r) => setTimeout(r, 120));
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastTimes[i] || c.times;
    const du = c.times.user - p.user;
    const dn = c.times.nice - p.nice;
    const ds = c.times.sys - p.sys;
    const di = c.times.idle - p.idle;
    const dq = c.times.irq - p.irq;
    idle += di;
    total += du + dn + ds + di + dq;
  });
  lastTimes = now.map((c) => ({ ...c.times }));
  const used = total > 0 ? 1 - idle / total : 0;
  return Math.max(0, Math.min(100, used * 100));
}

export interface MemoryUsage { total: number; used: number; free: number; percent: number }

/** Memory usage; on macOS prefers vm_stat since os.freemem() ignores inactive/purgeable pages. */
export async function memoryUsage(): Promise<MemoryUsage> {
  const total = os.totalmem();
  let used = total - os.freemem();
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await pexec('/usr/bin/vm_stat', [], { timeout: 2500 });
      const ps = /page size of (\d+) bytes/.exec(stdout);
      const size = ps ? Number(ps[1]) : 4096;
      const pages = (label: string): number => {
        const m = new RegExp(label + ':\\s+(\\d+)').exec(stdout);
        return m ? Number(m[1]) : 0;
      };
      const busy = pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor');
      if (busy > 0) used = busy * size;
    } catch { /* fall back to freemem */ }
  }
  used = Math.max(0, Math.min(total, used));
  return { total, used, free: Math.max(0, total - used), percent: total > 0 ? (used / total) * 100 : 0 };
}

export interface Temperature { celsius: number | null; source: string; speedLimit?: number | null }

/** Best-effort temperature. macOS needs a helper binary or elevated access, so this degrades honestly. */
export async function temperature(): Promise<Temperature> {
  if (process.platform === 'darwin') {
    const helpers = ['/opt/homebrew/bin/smctemp', '/usr/local/bin/smctemp', '/opt/homebrew/bin/osx-cpu-temp', '/usr/local/bin/osx-cpu-temp', 'smctemp', 'osx-cpu-temp'];
    for (const bin of helpers) {
      try {
        const { stdout } = await pexec(bin, [], { timeout: 2000 });
        const m = /(-?\d+(?:\.\d+)?)/.exec(stdout);
        if (m) {
          const c = Number(m[1]);
          if (c > -20 && c < 130) return { celsius: c, source: 'smctemp' };
        }
      } catch { /* try next helper */ }
    }
    try {
      const { stdout } = await pexec('/usr/bin/pmset', ['-g', 'therm'], { timeout: 2000 });
      const spd = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(stdout);
      return { celsius: null, source: 'pmset', speedLimit: spd ? Number(spd[1]) : null };
    } catch { /* ignore */ }
    return { celsius: null, source: 'unavailable' };
  }
  if (process.platform === 'linux') {
    try {
      const t = await fsp.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
      return { celsius: Number(t.trim()) / 1000, source: 'thermal_zone0' };
    } catch { /* ignore */ }
  }
  if (process.platform === 'win32') {
    try {
      const { stdout } = await pexec('powershell', ['-NoProfile', '-Command', '(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue).CurrentTemperature'], { timeout: 4000 });
      const v = parseInt(String(stdout).trim().split(/\s+/)[0], 10);
      if (!Number.isNaN(v)) return { celsius: v / 10 - 273.15, source: 'wmi' };
    } catch { /* ignore */ }
  }
  return { celsius: null, source: 'unavailable' };
}

export async function systemMetrics() {
  const [cpu, memory, temp] = await Promise.all([cpuUsage(), memoryUsage(), temperature()]);
  const disk = diskUsage(os.homedir());
  const diskPercent = disk.total > 0 ? (disk.used / disk.total) * 100 : 0;
  return {
    at: Date.now(),
    cpu,
    memory: { total: memory.total, used: memory.used, free: memory.free, percent: memory.percent },
    disk: { total: disk.total, used: disk.used, free: disk.free, percent: diskPercent },
    temperature: temp,
  };
}
