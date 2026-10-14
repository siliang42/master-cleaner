import path from 'path';
import fs from 'fs';
import { mkItem, sumSizes } from './helpers';
import { exists } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * App usage-trace cleaner ("只用痕迹清理").
 *
 * Chat / social / collaboration apps accumulate a large disposable footprint:
 * caches, code/GPU caches, crash reports, preview thumbnails and temporary
 * files. This module claims *only* those regenerable traces.
 *
 * Login safety is a hard guarantee, not a suggestion: session-dependent paths
 * (cookies, session/token stores, `Login Data`, `Local Storage/leveldb`,
 * keychains, ...) are recognised by `LOGIN_GUARD` and pruned from the walk, so
 * they can never become a cleanable candidate. Conversation history and your
 * received files are likewise never touched: only cache-suffixed subtrees are
 * matched. The user is told which login stores were protected and left alone.
 */

/** Directory names whose contents are safe to rebuild (lower-cased). */
const TRACE_NAMES = new Set([
  'cache',
  'cache2',
  'code cache',
  'gpucache',
  'cacheddata',
  'dawncache',
  'dawngraphitecache',
  'grshadercache',
  'shadercache',
  'media cache',
  'mediacache',
  'image cache',
  'imagecache',
  'video cache',
  'videocache',
  'filecache',
  'files cache',
  'downloadcache',
  'preview cache',
  'previewcache',
  'thumb',
  'thumbnail',
  'thumbnails',
  'blob_storage',
  'service worker',
  'crashpad',
  'logs',
  'log',
  'tmp',
  'temp',
]);

/**
 * Directory names that hold (or may hold) login state. Any subtree matching
 * this is pruned from the walk and reported as protected, never cleaned.
 */
const LOGIN_GUARD = /(login|cookie|session|token|auth|credential|account|keychain|password|passwd|signin|sign-in|local storage|sessionstorage|identity|leveldb|network)/i;

/** Placeholder tokens resolved per-platform when building app roots. */
interface Tokens {
  [key: string]: string;
}

function tokens(ctx: Ctx): Tokens {
  const home = ctx.home;
  return {
    HOME: home,
    LIB: path.join(home, 'Library'),
    AS: path.join(home, 'Library', 'Application Support'),
    CONT: path.join(home, 'Library', 'Containers'),
    DOCS: path.join(home, 'Documents'),
    APPDATA: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    LOCAL: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    CONFIG: path.join(home, '.config'),
  };
}

function render(tpl: string, t: Tokens): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => t[k] ?? `{${k}}`);
}

interface TraceApp {
  name: string;
  /** Root templates; non-existent candidates are filtered out later. */
  roots: string[];
}

/**
 * Apps covered. Roots are templates so platform-specific paths resolve cleanly
 * and the ones that don't exist on the current OS drop out. Only cache-suffixed
 * children of these roots are ever proposed.
 */
const TRACE_APPS: TraceApp[] = [
  {
    name: '微信 WeChat',
    roots: [
      '{AS}/com.tencent.xinWeChat',
      '{CONT}/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat',
      '{CONT}/com.tencent.xinWeChat',
      '{DOCS}/WeChat Files',
      '{DOCS}/xwechat_files',
      '{APPDATA}/Tencent/WeChat',
    ],
  },
  {
    name: '企业微信 WeCom',
    roots: ['{AS}/com.tencent.WeWorkMac', '{AS}/WeWork', '{DOCS}/WXWork', '{APPDATA}/Tencent/WXWork'],
  },
  {
    name: 'QQ',
    roots: ['{AS}/com.tencent.qq', '{AS}/QQ', '{DOCS}/Tencent Files', '{APPDATA}/Tencent/QQ'],
  },
  {
    name: '钉钉 DingTalk',
    roots: ['{AS}/DingTalk', '{AS}/com.alibaba.DingTalkMac', '{APPDATA}/DingTalk'],
  },
  {
    name: '飞书 Feishu / Lark',
    roots: ['{AS}/Lark', '{AS}/Feishu', '{APPDATA}/Lark', '{APPDATA}/Feishu'],
  },
  {
    name: 'Telegram Desktop',
    roots: ['{AS}/Telegram Desktop', '{AS}/Telegram Desktop/tdata', '{APPDATA}/Telegram Desktop'],
  },
  {
    name: 'Slack',
    roots: ['{AS}/Slack', '{APPDATA}/Slack', '{CONFIG}/Slack'],
  },
  {
    name: 'Discord',
    roots: ['{AS}/discord', '{AS}/Discord', '{APPDATA}/discord', '{CONFIG}/discord'],
  },
  {
    name: 'WhatsApp',
    roots: ['{AS}/WhatsApp', '{APPDATA}/WhatsApp'],
  },
  {
    name: 'Microsoft Teams',
    roots: ['{AS}/Microsoft Teams', '{APPDATA}/Microsoft/Teams'],
  },
  {
    name: 'Zoom',
    roots: ['{AS}/zoom.us', '{APPDATA}/Zoom'],
  },
];

const MAX_DEPTH = 3;

interface WalkResult {
  hits: Array<{ path: string; name: string }>;
  guarded: string[];
}

/**
 * Walk a root looking for cache-suffixed directories, pruning any login/session
 * subtree so credentials are structurally unreachable. Depth-limited and loop
 * free; symlinks are ignored.
 */
function collectTrace(root: string, maxDepth = MAX_DEPTH): WalkResult {
  const hits: Array<{ path: string; name: string }> = [];
  const guarded: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const low = e.name.toLowerCase();
      if (LOGIN_GUARD.test(low)) {
        guarded.push(full);
        continue;
      }
      if (TRACE_NAMES.has(low)) {
        hits.push({ path: full, name: e.name });
        continue;
      }
      if (depth + 1 <= maxDepth) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return { hits, guarded };
}

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const guardedAll = new Set<string>();
  const t = tokens(ctx);

  for (const app of TRACE_APPS) {
    const roots = app.roots.map((r) => render(r, t)).filter((p) => exists(p));
    if (!roots.length) continue;

    const paths = new Set<string>();
    const names = new Set<string>();
    for (const root of roots) {
      try {
        const { hits, guarded } = collectTrace(root);
        for (const h of hits) {
          paths.add(h.path);
          names.add(h.name);
        }
        for (const g of guarded) guardedAll.add(g);
      } catch (e) {
        errors.push(`${app.name} ${root}: ${String(e)}`);
      }
    }
    if (!paths.size) continue;

    const list = Array.from(paths);
    const s = await sumSizes(list);
    const sample = Array.from(names).slice(0, 8).join('、');
    items.push(
      mkItem({
        module: 'app-traces',
        category: `应用使用痕迹 · ${app.name}`,
        label: `${app.name} 缓存与临时痕迹（${list.length} 项）`,
        detail: `${sample}${names.size > 8 ? ' 等' : ''}；均为可自动重建的缓存/临时文件，登录与聊天记录不受影响`,
        paths: list,
        kind: 'group',
        bytes: s.bytes,
        count: s.count,
        risk: 'safe',
        defaultSelected: true,
        strategy: 'quarantine',
        meta: { app: app.name, sample: list.slice(0, 12) },
      }),
    );
  }

  if (guardedAll.size) {
    const list = Array.from(guardedAll);
    items.push(
      mkItem({
        module: 'app-traces',
        category: '应用使用痕迹 · 登录保护',
        label: `已保护登录 / 会话目录（${list.length} 个）`,
        detail: `${list.slice(0, 6).join('\n')}${list.length > 6 ? `\n... 等 ${list.length} 个` : ''}`,
        paths: list,
        kind: 'info',
        bytes: 0,
        count: list.length,
        risk: 'expert',
        defaultSelected: false,
        strategy: 'info',
        meta: { protected: true },
      }),
    );
  }

  notes.push('仅清理可自动重建的缓存、缩略图、日志与临时文件；登录状态、会话令牌、Cookie 与聊天记录均不在清理范围内。');
  if (guardedAll.size) notes.push(`已识别并跳过 ${guardedAll.size} 个登录 / 会话相关目录。`);
  return {
    module: 'app-traces',
    title: '应用使用痕迹',
    description: '聊天 / 社交 / 协作应用的可重建缓存与临时痕迹清理，保留登录与聊天记录。',
    category: 'apps',
    risk: 'caution',
    supported: true,
    items,
    notes,
    errors,
  };
}

export const appTracesModule: CleanerModule = {
  id: 'app-traces',
  title: '应用使用痕迹',
  description: '仅清理聊天 / 社交 / 协作应用的使用痕迹（缓存、日志、临时文件），不清理登录与聊天记录。',
  category: 'apps',
  risk: 'caution',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan,
};
