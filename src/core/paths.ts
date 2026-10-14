import path from 'path';
import os from 'os';

/** Base directory for all Master Cleaner state (config, vault, schedules, logs). */
export function dataDir(): string {
  return process.env.MC_DATA_DIR || path.join(os.homedir(), '.master-cleaner');
}

export function vaultDir(): string {
  return path.join(dataDir(), 'vault');
}

export function configPath(): string {
  return path.join(dataDir(), 'config.json');
}

export function schedulesPath(): string {
  return path.join(dataDir(), 'schedules.json');
}

export function historyPath(): string {
  return path.join(dataDir(), 'history.json');
}

export function logPath(): string {
  return path.join(dataDir(), 'master-cleaner.log');
}
