import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { runScan, runClean, allModules, loadConfig, saveConfig } from './core/engine';
import { ScheduleStore, nextRun, describeCron } from './core/scheduler';
import { Vault } from './core/vault';
import { diskUsage, osLabel, isElevated } from './core/platform';
import { systemMetrics } from './core/metrics';
import { formatBytes } from './core/util';
import { dataDir } from './core/paths';
import type { ScanReport, CandidateItem } from './core/types';
import { LEGAL, DISCLAIMER_SUMMARY, copyrightLine, legalText } from './core/legal';
import { getLocale, localize, normalizeLocale, setLocale, t } from './i18n';

const WEB_DIR = path.join(__dirname, '..', 'web');
let lastReport: ScanReport | null = null;
let scanning = false;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function localizeItem(i: CandidateItem): CandidateItem {
  return { ...i, category: localize(i.category), label: localize(i.label), detail: i.detail ? localize(i.detail) : i.detail };
}
function localizeModule(m: ScanReport['modules'][number]): ScanReport['modules'][number] {
  return {
    ...m,
    title: localize(m.title),
    description: localize(m.description),
    notes: (m.notes || []).map((n) => localize(n)),
    items: (m.items || []).map(localizeItem),
  };
}
function localizeReport(r: ScanReport): ScanReport {
  return { ...r, modules: r.modules.map((m) => localizeModule(m)) };
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function statePayload() {
  const disk = diskUsage(os.homedir());
  const vault = new Vault();
  const store = new ScheduleStore();
  const schedules = (await store.list()).map((s) => ({ ...s, nextRun: nextRun(s.cron), description: localize(describeCron(s.cron)) }));
  const cfg = await loadConfig();
  return {
    version: LEGAL.version,
    locale: getLocale(),
    platform: process.platform,
    os: osLabel(),
    arch: process.arch,
    elevated: await isElevated(),
    home: os.homedir(),
    dataDir: dataDir(),
    disk: { ...disk, totalHuman: formatBytes(disk.total), usedHuman: formatBytes(disk.used), freeHuman: formatBytes(disk.free) },
    vault: { bytes: await vault.totalBytes(), bytesHuman: formatBytes(await vault.totalBytes()), runs: (await vault.runs()).slice(0, 20) },
    schedules,
    config: cfg,
    modules: allModules().map((m) => ({
      id: m.id,
      title: localize(m.title),
      description: localize(m.description),
      category: m.category,
      risk: m.risk,
      supported: m.platforms.includes(process.platform),
      defaultEnabled: m.defaultEnabled,
    })),
    hasReport: !!lastReport,
    legal: {
      productName: LEGAL.productName,
      version: LEGAL.version,
      licenseId: LEGAL.licenseId,
      licenseName: LEGAL.licenseName,
      projectUrl: LEGAL.projectUrl,
      contactEmail: LEGAL.contactEmail,
      attributionNotice: LEGAL.attributionNotice,
      copyright: copyrightLine(),
      disclaimer: DISCLAIMER_SUMMARY.map((l) => localize(l)),
    },
    runtime: {
      node: process.versions.node,
      electron: (process.versions as Record<string, string | undefined>).electron ?? null,
      chrome: (process.versions as Record<string, string | undefined>).chrome ?? null,
    },
    desktop: Boolean((process.versions as Record<string, string | undefined>).electron),
  };
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const langParam = url.searchParams.get('lang');
  if (langParam) setLocale(normalizeLocale(langParam));
  if (p === '/api/legal' && req.method === 'GET') {
    json(res, 200, { text: localize(legalText()) });
    return true;
  }
  if (p === '/api/state' && req.method === 'GET') {
    json(res, 200, await statePayload());
    return true;
  }
  if (p === '/api/modules' && req.method === 'GET') {
    json(res, 200, await statePayload());
    return true;
  }
  if (p === '/api/scan/stream' && req.method === 'GET') {
    if (scanning) { json(res, 429, { error: localize('已有扫描在进行中') }); return true; }
    scanning = true;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const modules = url.searchParams.get('modules')?.split(',').filter(Boolean);
    const includeExpert = url.searchParams.get('expert') === '1';
    try {
      const report = await runScan({ moduleIds: modules, opts: { includeExpert, includeInfo: true }, log: (m) => send('log', { message: localize(m) }) });
      lastReport = report;
      send('done', localizeReport(report));
    } catch (e) {
      send('error', { message: localize(String(e)) });
    } finally {
      scanning = false;
      res.end();
    }
    return true;
  }
  if (p === '/api/scan' && req.method === 'GET') {
    const report = await runScan({ opts: { includeInfo: true } });
    lastReport = report;
    json(res, 200, localizeReport(report));
    return true;
  }
  if (p === '/api/clean' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = new Set<string>((body.ids as string[]) || []);
    const mode = (body.mode as 'quarantine' | 'trash' | 'delete') || 'quarantine';
    const dryRun = !!body.dryRun;
    const source = (body.items as CandidateItem[]) || (lastReport ? lastReport.modules.flatMap((m) => m.items) : []);
    const items = source.filter((i) => ids.has(i.id));
    const { record, skipped } = await runClean(items, { mode, dryRun });
    json(res, 200, { record, skipped, recordHuman: { bytes: formatBytes(record.bytes) } });
    return true;
  }
  if (p === '/api/schedules' && req.method === 'GET') {
    json(res, 200, await statePayload());
    return true;
  }
  if (p === '/api/schedules' && req.method === 'POST') {
    const body = await readBody(req);
    const store = new ScheduleStore();
    const id = `sched-${Date.now().toString(36)}`;
    try {
      const s = await store.add({
        id,
        name: String(body.name || t('schedule.defaultName')),
        cron: String(body.cron || '0 3 * * *'),
        moduleIds: (body.moduleIds as string[]) || ['ai-residue', 'dev-caches', 'system-junk'],
        mode: (body.mode as 'quarantine' | 'trash' | 'delete') || 'quarantine',
        enabled: true,
      });
      json(res, 200, { ...s, nextRun: nextRun(s.cron) });
    } catch (e) {
      json(res, 400, { error: String(e) });
    }
    return true;
  }
  const schedMatch = p.match(/^\/api\/schedules\/([^/]+)(\/enable|\/disable)?$/);
  if (schedMatch) {
    const store = new ScheduleStore();
    const id = schedMatch[1];
    if (req.method === 'DELETE') {
      json(res, 200, { removed: await store.remove(id) });
      return true;
    }
    if (req.method === 'POST') {
      const enable = schedMatch[2] === '/enable';
      json(res, 200, { schedule: await store.setEnabled(id, enable) });
      return true;
    }
  }
  if (p === '/api/vault/restore' && req.method === 'POST') {
    const body = await readBody(req);
    const vault = new Vault();
    const result = await vault.restore(String(body.id));
    json(res, 200, result);
    return true;
  }
  if (p === '/api/vault/purge' && req.method === 'POST') {
    const body = await readBody(req);
    const vault = new Vault();
    const olderThan = body.olderThan ? Number(body.olderThan) : 0;
    const runs = await vault.runs();
    const count = olderThan > 0 ? runs.filter((r) => r.at < Date.now() - olderThan * 86400000).length : runs.length;
    const bytes = olderThan > 0 ? await vault.purgeOlderThan(olderThan) : await vault.purgeAll();
    json(res, 200, { bytes, bytesHuman: formatBytes(bytes), count });
    return true;
  }
  if (p === '/api/metrics' && req.method === 'GET') {
    json(res, 200, await systemMetrics());
    return true;
  }
  if (p === '/api/quick-clean' && req.method === 'POST') {
    if (scanning) { json(res, 429, { ok: false, error: localize('已有扫描在进行中') }); return true; }
    scanning = true;
    try {
      const report = await runScan({ opts: { includeInfo: false } });
      lastReport = report;
      const items = report.modules.flatMap((m) => m.items).filter((i) => i.defaultSelected && i.strategy !== 'info');
      const { record, skipped } = await runClean(items, { mode: 'quarantine', dryRun: false });
      json(res, 200, { ok: true, count: items.length, removed: record.removed, bytes: record.bytes, bytesHuman: formatBytes(record.bytes), skipped: skipped.length });
    } catch (e) {
      json(res, 500, { ok: false, error: String(e) });
    } finally {
      scanning = false;
    }
    return true;
  }
  if (p === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    json(res, 200, await saveConfig(body));
    return true;
  }
  return false;
}

async function serveStatic(res: http.ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.replace(/^\/+/, ''));
  const full = path.join(WEB_DIR, rel);
  if (!full.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const data = await fsp.readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

export function startServer(port: number, log = true): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      if (url.pathname.startsWith('/api/')) {
        void handleApi(req, res, url).then((handled) => {
          if (!handled) json(res, 404, { error: 'not found' });
        });
        return;
      }
      void serveStatic(res, url.pathname);
    });
    server.listen(port, '127.0.0.1', () => {
      if (log) {
        console.log(`\n  Master Cleaner ${localize('仪表盘已启动')}: http://127.0.0.1:${port}`);
        console.log(`  ${localize('数据目录')}: ${dataDir()}`);
        console.log(`  ${localize('按 Ctrl+C 退出')}\n`);
      }
      resolve(server);
    });
    server.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`端口 ${port} 已被占用，请用 --port 指定其他端口。`);
        process.exit(1);
      }
      throw e;
    });
  });
}

if (require.main === module) {
  void startServer(Number(process.env.PORT) || 43110);
}
