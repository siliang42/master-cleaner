import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { runCmd } from './util';

/**
 * Best-effort integration with the operating system's own recycle bin, so that
 * users who prefer "delete" semantics can still recover files from Finder's
 * Trash / Windows Recycle Bin / freedesktop trash.
 *
 * Returns the list of paths that could not be sent to the OS bin, allowing the
 * caller to fall back to the Vault.
 */
export async function sendToTrash(paths: string[], platform: NodeJS.Platform): Promise<string[]> {
  if (platform === 'darwin') return sendToTrashMac(paths);
  if (platform === 'win32') return sendToTrashWindows(paths);
  return sendToTrashLinux(paths);
}

async function sendToTrashMac(paths: string[]): Promise<string[]> {
  const trashDir = path.join(os.homedir(), '.Trash');
  const failed: string[] = [];
  for (const p of paths) {
    try {
      await fsp.mkdir(trashDir, { recursive: true });
      let dest = path.join(trashDir, path.basename(p));
      let n = 1;
      while (fs.existsSync(dest)) dest = path.join(trashDir, `${path.basename(p)} ${n++}`);
      await fsp.rename(p, dest);
    } catch {
      failed.push(p);
    }
  }
  return failed;
}

async function sendToTrashWindows(paths: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const p of paths) {
    const isDir = (() => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    })();
    const fn = isDir ? 'DeleteDirectory' : 'DeleteFile';
    const script = [
      'Add-Type -AssemblyName Microsoft.VisualBasic;',
      `[Microsoft.VisualBasic.FileIO.FileSystem]::${fn}('${p.replace(/'/g, "''")}',`,
      "'OnlyErrorDialogs','SendToRecycleBin');",
    ].join(' ');
    const r = await runCmd('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    if (!r.ok) failed.push(p);
  }
  return failed;
}

async function sendToTrashLinux(paths: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const p of paths) {
    const r = await runCmd('gio', ['trash', p]);
    if (!r.ok) failed.push(p);
  }
  return failed;
}
