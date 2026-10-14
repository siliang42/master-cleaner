import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { vaultDir, dataDir } from './paths';
import { ensureDir, dirSize, formatBytes } from './util';

/**
 * The Vault is Master Cleaner's own recycle bin. Instead of hard-deleting, the
 * default clean strategy *moves* files here, preserving a manifest that maps
 * every stored file back to its original location so `mc restore` can undo a
 * clean run. This is what makes "aggressive" cleaning safe.
 */

export interface VaultEntry {
  original: string;
  stored: string;
  isDir: boolean;
  bytes: number;
  at: number;
}

export interface VaultRun {
  id: string;
  at: number;
  mode: string;
  entries: VaultEntry[];
  bytes: number;
}

function runDir(runId: string): string {
  return path.join(vaultDir(), runId);
}

export function newRunId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Move a file or directory, falling back to copy+unlink across devices. */
export async function movePath(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') throw e;
    const st = await fsp.lstat(src);
    if (st.isDirectory()) {
      await fsp.cp(src, dest, { recursive: true, force: true });
      await fsp.rm(src, { recursive: true, force: true });
    } else {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    }
  }
}

/** Move every child of `src` into `dst`, renaming collisions. */
async function mergeInto(src: string, dst: string, notes: string[]): Promise<void> {
  await ensureDir(dst);
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of entries) {
    const from = path.join(src, d.name);
    let to = path.join(dst, d.name);
    if (fs.existsSync(to)) {
      if (d.isDirectory()) {
        await mergeInto(from, to, notes);
        await fsp.rm(from, { recursive: true, force: true });
        continue;
      }
      let n = 1;
      let alt = `${to}.restored`;
      while (fs.existsSync(alt)) alt = `${to}.restored-${n++}`;
      to = alt;
      notes.push(`目标已存在，已还原为 ${to}`);
    }
    await movePath(from, to);
  }
}

export class Vault {
  /** Move `paths` into the vault under `runId`, merging into an existing run. */
  async save(runId: string, mode: string, paths: string[]): Promise<VaultRun> {
    const dir = runDir(runId);
    await ensureDir(path.join(dir, 'files'));
    const existing = (await this.runs()).find((r) => r.id === runId);
    const entries: VaultEntry[] = existing ? [...existing.entries] : [];
    let i = entries.length;
    for (const original of paths) {
      let st: fs.Stats;
      try {
        st = await fsp.lstat(original);
      } catch {
        continue;
      }
      const size = st.isDirectory() ? (await dirSize(original)).bytes : st.size;
      const safeName = `${i++}_${path.basename(original) || 'item'}`;
      const stored = path.join(dir, 'files', safeName);
      try {
        await movePath(original, stored);
      } catch {
        i--;
        continue;
      }
      entries.push({ original, stored, isDir: st.isDirectory(), bytes: size, at: Date.now() });
    }
    const run: VaultRun = {
      id: runId,
      at: existing?.at ?? Date.now(),
      mode,
      entries,
      bytes: entries.reduce((a, e) => a + e.bytes, 0),
    };
    await this.mergeManifest(run);
    return run;
  }

  private async mergeManifest(run: VaultRun): Promise<void> {
    const manifestPath = path.join(dataDir(), 'vault-manifest.json');
    let all: VaultRun[] = [];
    try {
      all = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    } catch {
      all = [];
    }
    const idx = all.findIndex((r) => r.id === run.id);
    if (idx >= 0) all[idx] = run;
    else all.push(run);
    await ensureDir(dataDir());
    await fsp.writeFile(manifestPath, JSON.stringify(all, null, 2), 'utf8');
  }

  async runs(): Promise<VaultRun[]> {
    const manifestPath = path.join(dataDir(), 'vault-manifest.json');
    try {
      const all = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as VaultRun[];
      return all.sort((a, b) => b.at - a.at);
    } catch {
      return [];
    }
  }

  async totalBytes(): Promise<number> {
    return (await dirSize(vaultDir())).bytes;
  }

  async restore(runId: string): Promise<{ restored: number; errors: string[] }> {
    const run = (await this.runs()).find((r) => r.id === runId);
    if (!run) return { restored: 0, errors: [`未找到回收记录 ${runId}`] };
    let restored = 0;
    const errors: string[] = [];
    const failed: VaultEntry[] = [];
    for (const e of run.entries) {
      try {
        if (!fs.existsSync(e.stored)) {
          errors.push(`文件已不在回收站：${e.original}`);
          continue;
        }
        if (!fs.existsSync(e.original)) {
          await ensureDir(path.dirname(e.original));
          await movePath(e.stored, e.original);
        } else if (e.isDir) {
          // Target dir already exists (e.g. recreated since the clean): merge
          // contents back instead of failing on rename.
          await mergeInto(e.stored, e.original, errors);
          await fsp.rm(e.stored, { recursive: true, force: true });
        } else {
          let dest = `${e.original}.restored`;
          let n = 1;
          while (fs.existsSync(dest)) dest = `${e.original}.restored-${n++}`;
          await movePath(e.stored, dest);
          errors.push(`目标已存在，已还原为 ${dest}`);
        }
        restored++;
      } catch (err) {
        failed.push(e);
        errors.push(`${e.original}: ${String(err)}`);
      }
    }
    const all = (await this.runs()).filter((r) => r.id !== runId);
    if (failed.length) {
      // Keep the entries that could not be restored so nothing is lost.
      all.push({ ...run, entries: failed, bytes: failed.reduce((a, e) => a + e.bytes, 0) });
    }
    await fsp.writeFile(path.join(dataDir(), 'vault-manifest.json'), JSON.stringify(all, null, 2), 'utf8');
    if (!failed.length) await fsp.rm(runDir(runId), { recursive: true, force: true });
    return { restored, errors };
  }

  async purgeAll(): Promise<number> {
    const runs = await this.runs();
    const bytes = runs.reduce((a, r) => a + r.bytes, 0);
    for (const r of runs) {
      await fsp.rm(runDir(r.id), { recursive: true, force: true }).catch(() => undefined);
    }
    await fsp.writeFile(path.join(dataDir(), 'vault-manifest.json'), '[]', 'utf8');
    return bytes;
  }

  /** Delete vault runs older than `days`. */
  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = Date.now() - days * 86400000;
    const runs = await this.runs();
    let bytes = 0;
    const keep: VaultRun[] = [];
    for (const r of runs) {
      if (r.at < cutoff) {
        bytes += r.bytes;
        await fsp.rm(runDir(r.id), { recursive: true, force: true }).catch(() => undefined);
      } else {
        keep.push(r);
      }
    }
    await fsp.writeFile(path.join(dataDir(), 'vault-manifest.json'), JSON.stringify(keep, null, 2), 'utf8');
    return bytes;
  }

  summary(run: VaultRun): string {
    return `${run.id} · ${run.mode} · ${run.entries.length} 项 · ${formatBytes(run.bytes)}`;
  }
}
