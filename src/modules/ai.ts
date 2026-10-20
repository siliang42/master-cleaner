import path from 'path';
import fs from 'fs';
import { mkItem, sumSizes, findMarkerDirsSync } from './helpers';
import { exists, dirSize, formatBytes } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * The AI-era residue module. This is Master Cleaner's signature capability:
 * every competitor cleans browsers and caches, almost none understand the disk
 * footprint of AI coding agents (Claude Code, Codex, Cursor, ...), local model
 * weights (Ollama, Hugging Face), and AI desktop apps.
 *
 * Design principle: we separate *disposable* residue (caches, logs, telemetry,
 * shell snapshots) from *valuable* residue (conversation history, project
 * memory, model weights, extensions). Disposable items are pre-selected;
 * valuable ones stay `expert` and are never auto-selected, so a careless scan
 * never loses a chat log or a 40 GB model. They remain manually selectable
 * (expert mode only) because deleting an old model is a legitimate way to
 * reclaim space — it just has to be a deliberate choice.
 */

interface Row {
  path: string;
  category: string;
  label: string;
  risk: 'safe' | 'caution' | 'expert';
  strategy: 'quarantine' | 'info' | 'trash';
  selected: boolean;
  detail?: string;
}

function rows(home: string): Row[] {
  const h = home;
  const L = path.join(h, 'Library');
  const libAS = path.join(L, 'Application Support');
  const libC = path.join(L, 'Caches');
  const win = process.platform === 'win32';
  const local = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(h, 'AppData', 'Roaming');
  const base = win ? local : h;

  const out: Row[] = [];
  const add = (r: Row) => out.push(r);

  // ---- AI coding agents: disposable residues ------------------------------
  const disposable: Array<[string, string, string]> = [
    [path.join(h, '.claude', 'shell-snapshots'), 'Claude Code', 'Claude Code 终端快照'],
    [path.join(h, '.claude', 'statsig'), 'Claude Code', 'Claude Code 遥测缓存'],
    [path.join(h, '.claude', 'logs'), 'Claude Code', 'Claude Code 日志'],
    [path.join(h, '.claude', 'todos'), 'Claude Code', 'Claude Code 临时待办'],
    [path.join(h, '.codex', 'log'), 'OpenAI Codex', 'Codex 日志'],
    [path.join(h, '.codex', 'cache'), 'OpenAI Codex', 'Codex 缓存'],
    [path.join(h, '.codex', '.tmp'), 'OpenAI Codex', 'Codex 临时文件'],
    [path.join(h, '.gemini', 'tmp'), 'Gemini CLI', 'Gemini CLI 临时文件'],
    [path.join(h, '.aider', 'caches'), 'Aider', 'Aider 缓存'],
    [path.join(h, '.cursor', 'extensions', '.obsolete'), 'Cursor', 'Cursor 废弃扩展'],
    [path.join(libC, 'com.anthropic.claudefordesktop'), 'Claude Desktop', 'Claude 桌面版缓存'],
    [path.join(libAS, 'Cursor', 'Cache'), 'Cursor', 'Cursor 缓存'],
    [path.join(libAS, 'Cursor', 'Code Cache'), 'Cursor', 'Cursor 代码缓存'],
    [path.join(libAS, 'Cursor', 'GPUCache'), 'Cursor', 'Cursor GPU 缓存'],
    [path.join(libAS, 'Cursor', 'CachedData'), 'Cursor', 'Cursor 数据缓存'],
    [path.join(libAS, 'Cursor', 'logs'), 'Cursor', 'Cursor 日志'],
    [path.join(libAS, 'Windsurf', 'Cache'), 'Windsurf', 'Windsurf 缓存'],
    [path.join(libAS, 'Windsurf', 'Code Cache'), 'Windsurf', 'Windsurf 代码缓存'],
    [path.join(libAS, 'Windsurf', 'GPUCache'), 'Windsurf', 'Windsurf GPU 缓存'],
    [path.join(libAS, 'Trae', 'Cache'), 'Trae', 'Trae 缓存'],
    [path.join(libAS, 'Trae CN', 'Cache'), 'Trae', 'Trae CN 缓存'],
    [path.join(libAS, 'Code', 'Cache'), 'VS Code', 'VS Code 缓存'],
    [path.join(libAS, 'Code', 'CachedData'), 'VS Code', 'VS Code 数据缓存'],
    [path.join(libAS, 'Code', 'Code Cache'), 'VS Code', 'VS Code 代码缓存'],
    [path.join(libAS, 'Code', 'GPUCache'), 'VS Code', 'VS Code GPU 缓存'],
    [path.join(libAS, 'Code', 'logs'), 'VS Code', 'VS Code 日志'],
  ];
  if (win) {
    disposable.length = 0;
    disposable.push(
      [path.join(roaming, 'Code', 'Cache'), 'VS Code', 'VS Code 缓存'],
      [path.join(roaming, 'Code', 'CachedData'), 'VS Code', 'VS Code 数据缓存'],
      [path.join(roaming, 'Code', 'Code Cache'), 'VS Code', 'VS Code 代码缓存'],
      [path.join(roaming, 'Code', 'GPUCache'), 'VS Code', 'VS Code GPU 缓存'],
      [path.join(roaming, 'Code', 'logs'), 'VS Code', 'VS Code 日志'],
      [path.join(roaming, 'Cursor', 'Cache'), 'Cursor', 'Cursor 缓存'],
      [path.join(roaming, 'Cursor', 'Code Cache'), 'Cursor', 'Cursor 代码缓存'],
      [path.join(roaming, 'Cursor', 'GPUCache'), 'Cursor', 'Cursor GPU 缓存'],
      [path.join(roaming, 'Cursor', 'logs'), 'Cursor', 'Cursor 日志'],
      [path.join(h, '.claude', 'shell-snapshots'), 'Claude Code', 'Claude Code 终端快照'],
      [path.join(h, '.claude', 'statsig'), 'Claude Code', 'Claude Code 遥测缓存'],
      [path.join(h, '.codex', 'log'), 'OpenAI Codex', 'Codex 日志'],
      [path.join(local, 'Temp', 'codex'), 'OpenAI Codex', 'Codex 临时文件'],
    );
  }
  for (const [p, category, label] of disposable) {
    add({ path: p, category: `AI 编程助手 · ${category}`, label, risk: 'safe', strategy: 'quarantine', selected: true, detail: '可自动重建的缓存/日志/临时文件' });
  }

  // ---- AI coding agents: valuable residues (expert, never pre-selected) ---
  add({ path: path.join(h, '.claude', 'projects'), category: 'AI 编程助手 · Claude Code', label: 'Claude Code 会话记录', risk: 'expert', strategy: 'quarantine', selected: false, detail: '包含历史对话与项目上下文；开启专家模式后可勾选，默认移入安全回收站（可还原）' });
  add({ path: path.join(h, '.claude', 'history'), category: 'AI 编程助手 · Claude Code', label: 'Claude Code 输入历史', risk: 'expert', strategy: 'quarantine', selected: false, detail: '命令行输入历史；开启专家模式后可勾选' });
  add({ path: path.join(h, '.codex', 'sessions'), category: 'AI 编程助手 · Codex', label: 'Codex 会话回放', risk: 'expert', strategy: 'quarantine', selected: false, detail: 'rollout 记录，体积可能较大；开启专家模式后可勾选，默认移入安全回收站（可还原）' });
  add({ path: path.join(h, '.codex', 'history.jsonl'), category: 'AI 编程助手 · Codex', label: 'Codex 命令历史', risk: 'expert', strategy: 'quarantine', selected: false, detail: '命令行历史记录；开启专家模式后可勾选' });
  add({ path: path.join(h, '.cursor', 'extensions'), category: 'AI 编程助手 · Cursor', label: 'Cursor 扩展', risk: 'expert', strategy: 'quarantine', selected: false, detail: '已安装扩展，删除后会重新下载；开启专家模式后可勾选' });
  add({ path: path.join(libAS, 'Cursor', 'User', 'workspaceStorage'), category: 'AI 编程助手 · Cursor', label: 'Cursor 工作区状态', risk: 'expert', strategy: 'quarantine', selected: false, detail: '工作区缓存与状态；开启专家模式后可勾选' });
  add({ path: path.join(libAS, 'Cursor', 'User', 'History'), category: 'AI 编程助手 · Cursor', label: 'Cursor 本地文件历史', risk: 'expert', strategy: 'quarantine', selected: false, detail: '本地文件历史记录；开启专家模式后可勾选' });
  add({ path: path.join(h, '.continue', 'index'), category: 'AI 编程助手 · Continue', label: 'Continue 代码索引', risk: 'caution', strategy: 'quarantine', selected: false, detail: '重建索引需重新嵌入代码库' });
  add({ path: path.join(h, '.aider'), category: 'AI 编程助手 · Aider', label: 'Aider 数据目录', risk: 'expert', strategy: 'quarantine', selected: false, detail: '会话与缓存数据；开启专家模式后可勾选' });

  // ---- Local model weights (expert, selectable but never pre-selected) ----
  const models: Array<[string, string, string]> = [
    [path.join(base, '.ollama', 'models'), 'Ollama', 'Ollama 模型库'],
    [path.join(h, '.cache', 'huggingface'), 'Hugging Face', 'HF Hub 模型缓存'],
    [path.join(h, '.cache', 'torch'), 'PyTorch', 'Torch Hub 模型缓存'],
    [path.join(h, '.cache', 'whisper'), 'Whisper', 'Whisper 语音模型'],
    [path.join(h, '.cache', 'diffusers'), 'Diffusers', 'Diffusers 模型缓存'],
    [path.join(h, '.cache', 'pyannote'), 'Pyannote', '说话人分离模型'],
    [path.join(h, 'Library', 'Application Support', 'Jan', 'data'), 'Jan', 'Jan 本地模型'],
    [path.join(h, 'lm-studio', 'models'), 'LM Studio', 'LM Studio 模型'],
    [path.join(h, '.lmstudio', 'models'), 'LM Studio', 'LM Studio 模型'],
    [path.join(h, '.cache', 'lm-studio'), 'LM Studio', 'LM Studio 缓存'],
    [path.join(h, '.cache', 'llama.cpp'), 'llama.cpp', 'llama.cpp 缓存'],
    [path.join(h, '.cache', 'GPT4All'), 'GPT4All', 'GPT4All 模型'],
    [path.join(h, 'ComfyUI', 'models'), 'ComfyUI', 'ComfyUI 模型'],
    [path.join(h, 'stable-diffusion-webui', 'models'), 'SD WebUI', 'Stable Diffusion 模型'],
    [path.join(h, '.cache', 'mlx'), 'MLX', 'MLX 模型缓存'],
    [path.join(h, '.cache', 'vllm'), 'vLLM', 'vLLM 缓存'],
  ];
  for (const [p, category, label] of models) {
    add({ path: p, category: `本地大模型 · ${category}`, label, risk: 'expert', strategy: 'quarantine', selected: false, detail: '模型权重体积大，删除后需重新下载；开启专家模式后可勾选，默认移入安全回收站（可还原）' });
  }

  // ---- AI desktop app caches --------------------------------------------
  const aiApps: Array<[string, string]> = [
    ['com.openai.chat', 'ChatGPT 桌面版'],
    ['com.openai.chat.desktop', 'ChatGPT 桌面版'],
    ['com.anthropic.claudefordesktop', 'Claude 桌面版'],
    ['ai.perplexity.mac', 'Perplexity'],
    ['com.microsoft.copilot', 'Microsoft Copilot'],
    ['com.bytedance.doubao', '豆包'],
    ['com.moonshot.kimi', 'Kimi'],
    ['com.tencent.hunyuan', '腾讯元宝'],
  ];
  for (const [bid, name] of aiApps) {
    const root = win ? path.join(local, bid) : path.join(libAS, bid);
    for (const sub of ['Cache', 'Code Cache', 'GPUCache', 'CachedData', 'DawnCache', 'Service Worker/CacheStorage', 'logs']) {
      add({ path: path.join(root, sub), category: `AI 应用缓存 · ${name}`, label: `${name} · ${sub}`, risk: 'safe', strategy: 'quarantine', selected: true });
    }
  }

  // ---- Apple Intelligence local models (report only) ---------------------
  if (process.platform === 'darwin') {
    add({ path: '/System/Library/AssetsV2', category: 'Apple Intelligence', label: 'Apple 系统资产模型 (AssetsV2)', risk: 'expert', strategy: 'info', selected: false, detail: '随系统更新，SIP 保护不可删除；仅报告占用' });
  }

  return out;
}

async function scanProjectResidues(roots: string[], maxDepth = 3): Promise<CandidateItem[]> {
  const markers = ["'.claude'", "'.codex'", "'.cursor'", "'.continue'", "'.specstory'", "'.windsurf'"];
  const found: Array<{ marker: string; path: string }> = [];
  for (const r of roots) {
    if (r === path.dirname(r)) continue;
    for (const hit of findMarkerDirsSync(r, markers, maxDepth)) found.push({ marker: hit.marker, path: hit.path });
  }
  const byMarker = new Map<string, string[]>();
  for (const f of found) {
    const arr = byMarker.get(f.marker) ?? [];
    arr.push(f.path);
    byMarker.set(f.marker, arr);
  }
  const items: CandidateItem[] = [];
  for (const [marker, paths] of byMarker) {
    const s = await sumSizes(paths);
    if (s.bytes <= 0) continue;
    items.push(
      mkItem({
        module: 'ai-residue',
        category: '项目内 AI 残留',
        label: `项目中的 ${marker} 目录（${paths.length} 个）`,
        detail: paths.slice(0, 8).join("\n") + (paths.length > 8 ? `\n... 等 ${paths.length} 个` : ""),
        paths,
        kind: 'group',
        bytes: s.bytes,
        count: paths.length,
        risk: 'caution',
        defaultSelected: false,
        strategy: 'quarantine',
        meta: { marker, sample: paths.slice(0, 8) },
      }),
    );
  }
  return items;
}

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  for (const r of rows(ctx.home)) {
    if (!exists(r.path)) continue;
    try {
      const st = fs.lstatSync(r.path);
      const bytes = st.isDirectory() ? (await dirSize(r.path)).bytes : st.size;
      if (bytes <= 0 && r.strategy !== 'info') continue;
      items.push(
        mkItem({
          module: 'ai-residue',
          category: r.category,
          label: r.label,
          detail: r.detail,
          path: r.path,
          bytes,
          risk: r.risk,
          defaultSelected: r.selected,
          strategy: r.strategy,
        }),
      );
    } catch (e) {
      errors.push(`${r.path}: ${String(e)}`);
    }
  }

  try {
    const project = await scanProjectResidues(ctx.opts.roots, 3);
    items.push(...project);
    if (project.length) notes.push(`在扫描根目录下发现 ${project.length} 类项目级 AI 残留（默认不勾选）。`);
  } catch (e) {
    errors.push(String(e));
  }

  notes.push('AI 会话记录、模型权重等「有价值的残留」默认不勾选；开启专家模式后可手动勾选，默认移入安全回收站（可还原），不会误删历史与模型。');
  return {
    module: 'ai-residue',
    title: 'AI 时代残留',
    description: 'AI 编程助手（Claude Code / Codex / Cursor …）、本地大模型、AI 桌面应用缓存与项目内 AI 残留。',
    category: 'ai',
    risk: 'safe',
    supported: true,
    items,
    notes,
    errors,
  };
}

export const aiModule: CleanerModule = {
  id: 'ai-residue',
  title: 'AI 时代残留',
  description: 'AI 编程助手、本地大模型、AI 桌面应用的缓存、日志、会话与模型残留。',
  category: 'ai',
  risk: 'safe',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan,
};
