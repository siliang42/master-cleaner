/**
 * Shared type contracts for the Master Cleaner engine.
 *
 * Everything the scanner produces is a `CandidateItem`: a single, addressable
 * unit of reclaimable data with an explicit risk level, a clean strategy and a
 * default selection flag. Modules never delete anything themselves; they only
 * describe candidates, and the engine/safety layer decides how to act.
 */

export type RiskLevel = 'safe' | 'caution' | 'expert';

/** How a candidate should be handled when cleaning. */
export type CleanStrategy =
  | 'delete' // unlink permanently (only used for regenerable caches)
  | 'trash' // move to the OS recycle bin (recoverable)
  | 'quarantine' // move into Master Cleaner's own recoverable vault (default)
  | 'exec' // run a command (e.g. `docker system prune`)
  | 'info'; // report only, never touched

export type ModuleCategory =
  | 'system'
  | 'apps'
  | 'dev'
  | 'ai'
  | 'containers'
  | 'privacy'
  | 'largefiles'
  | 'duplicates'
  | 'downloads'
  | 'startup'
  | 'macos'
  | 'windows';

export type ItemKind = 'file' | 'dir' | 'group' | 'command' | 'info';

export interface CandidateItem {
  /** Stable, unique id (module + path or label). */
  id: string;
  /** Module id that produced this item. */
  module: string;
  /** Human readable group label, e.g. "AI coding agents". */
  category: string;
  /** Short label shown in the UI. */
  label: string;
  /** Longer explanation of what this is and why it is safe/unsafe. */
  detail?: string;
  /** Primary path (single-path items). */
  path?: string;
  /** All paths covered by this item (grouped items). */
  paths?: string[];
  kind: ItemKind;
  /** Reclaimable bytes. */
  bytes: number;
  /** Number of files/dirs covered. */
  count?: number;
  risk: RiskLevel;
  /** Whether the item is checked by default (only sanitized via risk rules). */
  defaultSelected: boolean;
  strategy: CleanStrategy;
  /** Shell command for `exec` strategy items. */
  command?: string;
  /**
   * True when another (larger-scope) item already accounts for this item's
   * paths, so its bytes are not added to the totals a second time. Such an item
   * is still cleanable; only aggregate numbers and UI badges change.
   */
  duplicate?: boolean;
  /** Id of the item that already covers this one (when `duplicate`). */
  duplicateOf?: string;
  /** Free-form metadata for the UI (age, vendor, volume, ...). */
  meta?: Record<string, unknown>;
}

export interface ScanOptions {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Roots used by file-system-wide modules (large files, duplicates). */
  roots: string[];
  /** Files larger than this (bytes) are reported by the large-files module. */
  minLargeBytes: number;
  /** Include items flagged as `expert` risk. */
  includeExpert: boolean;
  /** Include informational (report-only) items. */
  includeInfo: boolean;
  /** Max directory depth for recursive walks. */
  maxDepth: number;
  /** Ignore entries newer than this many days (0 = don't ignore). */
  minAgeDays: number;
  now: number;
  verbose: boolean;
}

export interface Ctx {
  opts: ScanOptions;
  platform: NodeJS.Platform;
  home: string;
  log: (msg: string) => void;
}

export interface ModuleResult {
  module: string;
  title: string;
  description: string;
  category: ModuleCategory;
  risk: RiskLevel;
  supported: boolean;
  items: CandidateItem[];
  notes: string[];
  errors: string[];
}

export interface ExecOutcome {
  removed: number;
  bytes: number;
  skipped: number;
  errors: string[];
}

export interface CleanerModule {
  id: string;
  title: string;
  description: string;
  category: ModuleCategory;
  risk: RiskLevel;
  /** Platforms this module supports. `process.platform` values. */
  platforms: NodeJS.Platform[];
  defaultEnabled: boolean;
  scan(ctx: Ctx): Promise<ModuleResult>;
  /** Optional custom executor for `exec` items. */
  exec?(item: CandidateItem, ctx: Ctx): Promise<ExecOutcome>;
}

export interface ScanReport {
  startedAt: number;
  finishedAt: number;
  platform: NodeJS.Platform;
  modules: ModuleResult[];
  /** Non-duplicate bytes across every item (reclaimable + report-only). */
  totalBytes: number;
  totalItems: number;
  /** Bytes that can actually be reclaimed (non-`info`, non-duplicate items). */
  reclaimableBytes: number;
  /** Bytes surfaced for information only and never deleted (models, VM images, ...). */
  reportOnlyBytes: number;
  /** Bytes withheld from the totals because another item already covers them. */
  duplicateBytes: number;
  /** Bytes pre-selected for cleaning (default-selected, non-`info`). */
  selectedBytes: number;
  errors: string[];
}

export interface CleanRecord {
  id: string;
  at: number;
  mode: string;
  items: Array<{ id: string; label: string; bytes: number; paths: string[]; strategy: CleanStrategy }>;
  removed: number;
  bytes: number;
  errors: string[];
}
