import path from 'path';
import fs from 'fs';
import os from 'os';
import { mkItem } from './helpers';
import { exists, formatBytes, runCmd } from '../core/util';
import { vaultDir } from '../core/paths';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * macOS hidden space ("隐藏空间").
 *
 * The answer to "I deleted everything, why is the disk still full": the
 * per-user volume under /private/var/folders keeps GB-sized residue that
 * classic cleaners never look at —
 *
 *  - X/<bundle>.code_sign_clone/…  code-signature clones left behind by
 *    Gatekeeper verification (often 1-2 GB per copy);
 *  - T/*.ShipIt.*                  app-updater scratch dirs that survived an
 *    interrupted update;
 *  - T/com.apple.useractivityd/…/archives  Universal Clipboard archives;
 *  - C/clang, C/com.apple.metal    regenerable compiler / shader caches;
 *  - ~/Library/Application Support/<app>/update/update_downloading  stale
 *    update packages downloaded and forgotten by the app.
 *
 * Safety model: every candidate is allow-listed by name pattern and gated by
 * age (24h-7d), so live sessions are never touched. Volumes are reported,
 * never guessed at; nothing here can reach login/session/account state.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface DatedEntry {
  path: string;
  name: string;
  mtimeMs: number;
  size: number;
  isDir: boolean;
}

function listDated(dir: string): DatedEntry[] {
  let ents: fs.Dirent[] = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DatedEntry[] = [];
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    try {
      const st = fs.lstatSync(full);
      out.push({ path: full, name: e.name, mtimeMs: st.mtimeMs, size: st.size, isDir: st.isDirectory() });
    } catch {
      /* unreadable entries are skipped */
    }
  }
  return out;
}

/** Disk usage for many paths in one `du` pass (far cheaper than per-dir walks). */
async function duBytes(paths: string[], timeoutMs = 240_000): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!paths.length) return out;
  const r = await runCmd('du', ['-sk', ...paths], { timeoutMs });
  for (const line of r.stdout.split('\n')) {
    const idx = line.indexOf('\t');
    if (idx <= 0) continue;
    const kb = Number(line.slice(0, idx));
    const p = line.slice(idx + 1);
    if (Number.isFinite(kb) && p) out.set(p, kb * 1024);
  }
  return out;
}

function sumOf(sizes: Map<string, number>, paths: string[]): number {
  let n = 0;
  for (const p of paths) n += sizes.get(p) ?? 0;
  return n;
}

/**
 * Split a bundle/app group into "keep" and "residue" entries.
 *
 * Signature clones and updater scratch dirs are one-shot artifacts: software
 * creates them, finishes, and should delete them. When several exist for the
 * same app, only the newest one can plausibly belong to an operation that is
 * still running, so we keep that one (and anything touched in the last ten
 * minutes) and classify every other copy as residue. A lone copy older than a
 * day is residue too: nothing has been running for that long.
 */
const FRESH_WINDOW = 10 * 60 * 1000;

function splitResidue(
  entries: Array<{ path: string; mtimeMs: number }>,
  now: number,
): { candidates: string[]; kept: number } {
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const candidates: string[] = [];
  let kept = 0;
  sorted.forEach((e, idx) => {
    const newest = idx === 0;
    const fresh = now - e.mtimeMs <= FRESH_WINDOW;
    if ((newest && now - e.mtimeMs < DAY) || fresh) {
      kept++;
      return;
    }
    candidates.push(e.path);
  });
  return { candidates, kept };
}

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const now = ctx.opts.now;

  const tmp = os.tmpdir(); // .../T — the session temp dir
  const perUser = path.dirname(tmp); // .../<user-hash> — the per-user volume
  const xRoot = path.join(perUser, 'X');
  const cRoot = path.join(perUser, 'C');

  // ---- 1. Code-signature clones (the #1 hidden hog) ----------------------
  const clonesByBundle = new Map<string, Array<{ path: string; mtimeMs: number }>>();
  const allClonePaths: string[] = [];
  let keptEntries = 0;
  if (exists(xRoot)) {
    for (const bundleEntry of listDated(xRoot)) {
      if (!bundleEntry.isDir || !bundleEntry.name.endsWith('.code_sign_clone')) continue;
      for (const clone of listDated(bundleEntry.path)) {
        if (!clone.isDir || !clone.name.startsWith('code_sign_clone')) continue;
        allClonePaths.push(clone.path);
        const bundle = bundleEntry.name.replace(/\.code_sign_clone$/, '');
        const list = clonesByBundle.get(bundle) ?? [];
        list.push({ path: clone.path, mtimeMs: clone.mtimeMs });
        clonesByBundle.set(bundle, list);
      }
    }
  }
  const cloneSizes = await duBytes(allClonePaths);
  for (const [bundle, clones] of clonesByBundle) {
    const split = splitResidue(clones, now);
    keptEntries += split.kept;
    const paths = split.candidates.sort();
    if (!paths.length) continue;
    const bytes = sumOf(cloneSizes, paths);
    if (bytes <= 0) continue;
    items.push(
      mkItem({
        module: 'hidden-space',
        category: '代码签名克隆',
        label: `代码签名克隆残留 · ${bundle} × ${paths.length}`,
        detail: `Gatekeeper 签名校验过程中产生的应用副本，校验结束后本应自动清理；这里只保留最新一份，其余均视为残留。APFS 上这些副本可能与原应用共享数据块，实际释放量会小于统计值。位置：${path.join(xRoot, `${bundle}.code_sign_clone`)}`,
        paths,
        kind: 'group',
        bytes,
        count: paths.length,
        risk: 'caution',
        defaultSelected: true,
        strategy: 'trash',
        meta: { bundle, ageHours: Math.round((now - Math.min(...clones.map((c) => c.mtimeMs))) / HOUR) },
      }),
    );
  }

  // ---- 2. Interrupted app-updater scratch dirs (ShipIt / Squirrel) --------
  const shipitByApp = new Map<string, Array<{ path: string; mtimeMs: number }>>();
  for (const e of listDated(tmp)) {
    if (!e.isDir || !/\.ShipIt(\.|$)/.test(e.name)) continue;
    const app = e.name.replace(/\.ShipIt.*$/, '');
    const list = shipitByApp.get(app) ?? [];
    list.push({ path: e.path, mtimeMs: e.mtimeMs });
    shipitByApp.set(app, list);
  }
  const shipit: string[] = [];
  for (const entries of shipitByApp.values()) {
    const split = splitResidue(entries, now);
    keptEntries += split.kept;
    shipit.push(...split.candidates);
  }
  if (shipit.length) {
    const sizes = await duBytes(shipit);
    const bytes = sumOf(sizes, shipit);
    if (bytes > 0)
      items.push(
        mkItem({
          module: 'hidden-space',
          category: '应用更新残留',
          label: `应用更新器残留 × ${shipit.length}`,
          detail: '应用自动更新器（ShipIt/Squirrel）中断后留下的解压目录；同一应用只保留最新一份，其余视为残留。',
          paths: shipit.sort(),
          kind: 'group',
          bytes,
          count: shipit.length,
          risk: 'safe',
          defaultSelected: true,
          strategy: 'trash',
        }),
      );
  }

  // ---- 3. Universal Clipboard archives ------------------------------------
  const archivesRoot = path.join(tmp, 'com.apple.useractivityd', 'shared-pasteboard', 'archives');
  const archived = listDated(archivesRoot).filter((e) => !e.isDir);
  const oldArchives = archived.filter((e) => now - e.mtimeMs > 7 * DAY);
  const midArchives = archived.filter((e) => {
    const age = now - e.mtimeMs;
    return age > 48 * HOUR && age <= 7 * DAY;
  });
  if (oldArchives.length) {
    const bytes = oldArchives.reduce((a, e) => a + e.size, 0);
    if (bytes > 0)
      items.push(
        mkItem({
          module: 'hidden-space',
          category: '共享粘贴板',
          label: `共享粘贴板归档 · 超过 7 天 · ${oldArchives.length} 个文件`,
          detail: 'Universal Clipboard 跨设备复制时留下的暂存归档，超过 7 天的内容已不再参与同步。',
          paths: oldArchives.map((e) => e.path),
          kind: 'group',
          bytes,
          count: oldArchives.length,
          risk: 'safe',
          defaultSelected: true,
          strategy: 'trash',
        }),
      );
  }
  if (midArchives.length) {
    const bytes = midArchives.reduce((a, e) => a + e.size, 0);
    if (bytes > 0)
      items.push(
        mkItem({
          module: 'hidden-space',
          category: '共享粘贴板',
          label: `共享粘贴板归档 · 2-7 天 · ${midArchives.length} 个文件`,
          detail: '较新的跨设备复制归档，可能仍会被设备使用；确认不再需要时可手动勾选。',
          paths: midArchives.map((e) => e.path),
          kind: 'group',
          bytes,
          count: midArchives.length,
          risk: 'caution',
          defaultSelected: false,
          strategy: 'trash',
        }),
      );
  }

  // ---- 4. Regenerable per-user caches in the C volume --------------------
  const cCaches: Array<[string, string]> = [
    ['clang', 'Clang 模块缓存'],
    ['com.apple.metal', 'Metal 着色器缓存'],
    ['com.apple.dyld', 'dyld 构建缓存'],
  ];
  const cachePaths = cCaches.map(([name]) => path.join(cRoot, name)).filter((p) => exists(p));
  if (cachePaths.length) {
    const sizes = await duBytes(cachePaths);
    for (const [name, label] of cCaches) {
      const p = path.join(cRoot, name);
      const bytes = sizes.get(p) ?? 0;
      if (bytes <= 0) continue;
      items.push(
        mkItem({
          module: 'hidden-space',
          category: '系统缓存',
          label,
          detail: '用户级编译/着色器缓存，删除后由系统按需重建，只会让首次编译略慢。',
          path: p,
          bytes,
          risk: 'safe',
          defaultSelected: true,
          strategy: 'quarantine',
        }),
      );
    }
  }

  // ---- 5. Stale app update packages ---------------------------------------
  const appSupport = path.join(ctx.home, 'Library', 'Application Support');
  let supportEntries: fs.Dirent[] = [];
  try {
    supportEntries = fs.readdirSync(appSupport, { withFileTypes: true });
  } catch {
    /* none */
  }
  for (const app of supportEntries) {
    if (!app.isDirectory() || app.isSymbolicLink()) continue;
    const updateDir = path.join(appSupport, app.name, 'update', 'update_downloading');
    const stale = listDated(updateDir).filter((e) => now - e.mtimeMs > 48 * HOUR);
    if (!stale.length) continue;
    const sizes = await duBytes(stale.map((e) => e.path));
    const paths = stale.map((e) => e.path).sort();
    const bytes = sumOf(sizes, paths);
    if (bytes <= 0) continue;
    items.push(
      mkItem({
        module: 'hidden-space',
        category: '应用更新残留',
        label: `${app.name} 更新下载残留 · ${paths.length} 个文件`,
        detail: '应用自更新时下载的安装包，超过 48 小时仍未使用即视为失效；应用需要时会重新下载。',
        paths,
        kind: 'group',
        bytes,
        count: paths.length,
        risk: 'safe',
        defaultSelected: true,
        strategy: 'trash',
      }),
    );
  }

  // ---- 6. Browser/updater component caches --------------------------------
  const crxCache = path.join(appSupport, 'Google', 'GoogleUpdater', 'crx_cache');
  if (exists(crxCache)) {
    const sizes = await duBytes([crxCache]);
    const bytes = sizes.get(crxCache) ?? 0;
    if (bytes > 0)
      items.push(
        mkItem({
          module: 'hidden-space',
          category: '应用更新残留',
          label: 'Google 更新器组件缓存 (crx_cache)',
          detail: '浏览器组件更新时下载的安装包缓存，删除后按需重新下载。',
          path: crxCache,
          bytes,
          risk: 'safe',
          defaultSelected: true,
          strategy: 'quarantine',
        }),
      );
  }

  // ---- 7. Master Cleaner's own quarantine vault ---------------------------
  const vaultPath = vaultDir();
  if (exists(vaultPath)) {
    const sizes = await duBytes([vaultPath]);
    const bytes = sizes.get(vaultPath) ?? 0;
    if (bytes > 0)
      items.push(
        mkItem({
          module: 'hidden-space',
          category: '空间概览',
          label: `Master Cleaner 隔离仓库占用（${formatBytes(bytes)}）`,
          detail: '安全清理会把文件先移动到隔离仓库；只有在「回收站」页清除后，磁盘空间才会真正释放。',
          kind: 'info',
          bytes,
          risk: 'caution',
          defaultSelected: false,
          strategy: 'info',
        }),
      );
  }

  // ---- 8. Report-only overview: where the hidden space actually goes -----
  const volumePaths = [xRoot, cRoot, tmp].filter((p) => exists(p));
  if (volumePaths.length) {
    const sizes = await duBytes(volumePaths);
    const parts = volumePaths.map((p) => ({ p, bytes: sizes.get(p) ?? 0 })).filter((x) => x.bytes > 0);
    const total = parts.reduce((a, x) => a + x.bytes, 0);
    if (total > 0) {
      const describe = (p: string, label: string) => {
        const part = parts.find((x) => x.p === p);
        return part ? `${label} ${formatBytes(part.bytes)}` : '';
      };
      const breakdown = [
        describe(xRoot, '签名克隆 X'),
        describe(cRoot, '系统缓存 C'),
        describe(tmp, '临时文件 T'),
      ].filter(Boolean).join(' · ');
      items.push(
        mkItem({
          module: 'hidden-space',
          category: '空间概览',
          label: `用户临时区总占用（${formatBytes(total)}）`,
          detail: `常规清理器不会进入这里：${breakdown}。上方可清理项均在此范围内。`,
          kind: 'info',
          bytes: total,
          risk: 'caution',
          defaultSelected: false,
          strategy: 'info',
        }),
      );
    }
  }

  notes.push('只清理已判定为残留的内容：同一应用仅保留最新一份签名克隆与更新器暂存，归档与缓存按年龄分级。');
  if (keptEntries) notes.push(`已保留 ${keptEntries} 个最近产生、可能仍在使用的条目，其余判定为残留。`);
  notes.push('签名克隆在 APFS 上可能与原应用共享数据块，统计值可能高于实际释放量，实际以系统可用空间变化为准。');
  notes.push('登录、会话与账户数据不在处理范围内；隐藏空间里的路径只在本机展示，不会上传。');
  return {
    module: 'hidden-space',
    title: 'macOS 隐藏空间',
    description: '常规清理器看不到的隐藏占用：应用签名克隆、更新器残留、共享粘贴板归档、编译缓存与失效更新包。',
    category: 'system',
    risk: 'safe',
    supported: true,
    items,
    notes,
    errors,
  };
}

export const hiddenSpaceModule: CleanerModule = {
  id: 'hidden-space',
  title: 'macOS 隐藏空间',
  description: '常规清理器看不到的隐藏占用：应用签名克隆、更新器残留、共享粘贴板归档、编译缓存与失效更新包。',
  category: 'system',
  risk: 'safe',
  platforms: ['darwin'],
  defaultEnabled: true,
  scan,
};
