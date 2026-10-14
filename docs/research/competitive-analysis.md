# 竞品调研与 AI 时代痛点分析

> 目标：为 Master Cleaner 的功能取舍提供依据。调研对象是三家代表性清理软件
> （腾讯柠檬清理、CleanMyMac X、360 安全卫士），并补充 AI / 开发者 / 原生系统
> 在 2024–2026 年集中出现的磁盘痛点。
>
> 说明：本文为功能层面的能力归纳，不含对任何产品的源代码或界面的复制。

## 一、三家竞品的功能地图

### 1. 腾讯柠檬清理（Lemon）

轻量、常驻菜单栏的 macOS 清理工具，主打“看得见的清爽”。

| 能力 | 说明 |
| --- | --- |
| 垃圾清理 | 系统缓存、应用缓存、日志、废纸篓、浏览器缓存 |
| 大文件清理 | 找出并排序大文件 |
| 重复文件 | 按内容比对重复项 |
| 相似照片 | 近似照片识别（清理思路，非逐像素模板） |
| 应用卸载 | 卸载应用并清理残留文件 |
| 隐私清理 | 浏览器历史 / 缓存等痕迹 |
| 状态监控 | 菜单栏实时网速、内存、磁盘占用 |
| 深度清理 | 面向系统缓存的进一步清理 |

**可借鉴**：菜单栏常驻 + 实时监控带来的“随时可清理”体验；应用残留清理；
“相似照片/大文件”这种可视化、可判断的清理对象；整体轻量、不打扰。

### 2. CleanMyMac X

功能最完整的 macOS 清理套件，工程体验与安全性做得最扎实。

| 能力 | 说明 |
| --- | --- |
| Smart Scan | 一键式智能扫描入口 |
| System Junk | 系统垃圾（缓存、日志、本地化、破损偏好等，多子类） |
| Mail Attachments | 邮件附件本地缓存 |
| Trash Bins | 各废纸篓 |
| Large & Old Files | 大文件与旧文件 |
| Space Lens | 磁盘空间可视化（按目录树查看占用） |
| Duplicates | 重复文件查找 |
| Shredder | 覆写式安全删除（碎纸机） |
| Privacy | 浏览数据、最近项等隐私痕迹 |
| Applications | 卸载器 / 更新器 / 扩展管理 |
| Protection | 恶意软件移除 |
| Performance | 维护脚本、释放内存、启动项、电池健康 |

**可借鉴**：Smart Scan 的“一键 + 分类明细”；Space Lens 的磁盘可视化；
维护脚本 / 启动项这类“性能”面板；默认只勾选安全项、危险项显式确认的安全观。

### 3. 360 安全卫士（电脑清理 / 软件管家 / 系统优化）

Windows 端用户量最大的工具箱，习惯养成与系统级操作最激进。

| 能力 | 说明 |
| --- | --- |
| 电脑清理 | 全盘扫描 + 一键清理，覆盖数十类垃圾与“插件” |
| C 盘瘦身 | 面向系统盘的空间回收向导 |
| 软件管家 | 软件卸载 + **软件搬家**（把大软件/大文件移到其它盘） |
| 开机加速 | 启动项、计划任务、服务的开关 |
| 弹窗过滤 | 拦截软件弹窗广告 |
| 系统修复 | 漏洞修补、异常修复、注册表问题 |
| 隐私清理 | 上网痕迹清理 |
| 风险保护 | 内置“风险文件”白名单，清理时跳过系统关键文件 |

**可借鉴**：“C 盘瘦身”这类**有针对性地解决系统盘告急**的向导；
**软件搬家**（把占用从紧张的分区迁移出去）；开机启动项管理；
“风险文件白名单 / 跳过关键文件”的安全理念——这与 Master Cleaner 的安全层同源。

## 二、AI 时代的真实痛点（2024–2026）

三家传统清理软件都诞生于“浏览器 + 系统缓存”时代，几乎都没有专门处理
AI / 开发者 / 容器带来的新型占用。这些恰恰是当前最容易把磁盘塞满的东西。

### 1. AI 编码代理的残留

- Claude Code：`~/.claude/`（`projects` 会话、`shell-snapshots`、`todos`、`statsig`、`logs`）。
- OpenAI Codex：`~/.codex/`（`sessions` rollout、`log`、`history.jsonl`、临时文件）。
- Cursor / Windsurf / Trae / VS Code：`Application Support/<IDE>/` 下的
  `Cache`、`Code Cache`、`GPUCache`、`CachedData`、`workspaceStorage`、`History`、扩展目录。
- 其它：Aider、Continue、Cline、Gemini CLI、Qwen Code 等各自的缓存与索引。

**痛点**：代理越用越“重”，会话与索引文件散落在多个隐藏目录，用户既看不见
也不知道哪些能删、哪些删了会丢历史。

### 2. 本地大模型的“下载即遗忘”

- Ollama：`~/.ollama/models`（动辄 4–40 GB）。
- Hugging Face Hub：`~/.cache/huggingface`；PyTorch `~/.cache/torch`；
  Whisper、Diffusers、Pyannote 等。
- LM Studio、Jan、GPT4All、ComfyUI、Stable Diffusion WebUI 的模型目录。

**痛点**：模型权重巨大且复制/多份，试用一次就长期占盘；普通清理软件完全无视。

### 3. 容器与虚拟机磁盘

- Docker：悬空镜像、构建缓存、停止的容器、未使用数据卷；
  Docker Desktop 的 `Docker.raw`、Colima / Lima / OrbStack 的虚拟机镜像。
- WSL2：`ext4.vhdx` 随使用只增不减，即使删了文件也不会自动收缩。

**痛点**：这些镜像常以稀疏文件形式存在，**逻辑体积**可达上百 GB，
系统“储存空间”里只显示为“其他/系统数据”，用户无从下手。

### 4. 开发者构建缓存

`npm/pnpm/yarn` 缓存、`pip/uv/conda/poetry` 缓存、`cargo`、`go build`、
`gradle/maven`、Xcode `DerivedData`/`DeviceSupport`/`Archives`，
以及项目内的 `node_modules`、`.venv/venv`、`__pycache__`、`.next/.nuxt/.turbo`、`target`。

**痛点**：单个项目不起眼，多个项目叠加可达数十 GB；但删错会破坏环境。

### 5. 原生系统的“看不见”

- macOS：**Apple Intelligence 本地模型**难以删除（2025 年 RemoveMacAI 事件）；
  “系统数据（System Data）”不显示明细；Time Machine 本地快照；
  iOS 设备备份；`.DS_Store`；Spotlight 索引。
- Windows：`WinSxS` 组件存储、`Windows.old`、`hiberfil.sys`、Windows 更新缓存、
  缩略图 / 着色器缓存、传递优化缓存、回收站。

**痛点**：系统自带的清理入口分散（磁盘清理、DISM、存储感知），
且对“AI 模型”这类新资产基本没有对应操作。

### 6. 隐私痕迹

浏览器历史 / Cookie / 登录数据、macOS“最近使用（SharedFileList）”、
输入法/剪贴板工具缓存（如 PasteNow 的 `HTTPStorages`/`WebKit`）。

## 三、Master Cleaner 的差异化定位

1. **把“AI 残留”做成一等公民**：AI 编程代理、本地大模型、AI 桌面应用、
   项目内 AI 目录，独立模块并给出精确体积。
2. **区分“可重建残留”与“有价值残留”**：缓存/日志/临时文件默认勾选且安全；
   会话记录、模型权重、扩展等标为 `expert` 且**默认不勾选、仅统计体积**，
   避免误删历史与模型。这是相比“一把梭全删”的关键差异。
3. **默认“可还原”**：清理默认移入自带的**安全回收站**（Vault），可一键还原；
   另提供系统回收站与永久删除两种显式模式。
4. **安全层（denylist + allowlist）**：越界路径只报告不删除，理念与 360 的
   “风险文件白名单”一致。
5. **跨平台一致**：macOS / Windows / Linux 同一套引擎与规则；
   借鉴 360 的“C 盘瘦身/系统盘告急”场景，Windows 侧专列系统级大件检测与指引。
6. **定时清理**：内置 `mc daemon`，或导出为 launchd / schtasks / cron。
7. **本地优先 + 开源**：数据不出本机；AGPLv3，规则可审计可扩展。

## 四、功能映射表（借鉴 → 实现）

| 借鉴来源 | 能力 | Master Cleaner 模块 |
| --- | --- | --- |
| Lemon / CleanMyMac | 缓存/日志/系统垃圾 | `system-junk` |
| Lemon / CleanMyMac | 应用卸载 + 残留 | `app-leftovers` |
| Lemon | 大文件 / 重复文件 | `large-files` / `duplicates` |
| CleanMyMac | 空间透镜（可视化） | 仪表盘分类聚合 + 大文件明细 |
| CleanMyMac | 维护/性能 | `startup-items`（启动项盘点） |
| 360 | C 盘瘦身 / 系统级大件 | `windows-system`（WinSxS、更新缓存、休眠文件等） |
| 360 / CleanMyMac | 隐私清理 | `browser-privacy` |
| 360 / CleanMyMac | 安全白名单 | 引擎安全层 `safety.ts` |
| ——（新增） | AI 编码代理 / 模型 / 容器 | `ai-residue` / `containers` |
| ——（新增） | 开发者缓存 | `dev-caches` |
| ——（新增） | 废纸篓与安全回收站 | `trash-bins` + Vault |

## 五、参考来源（公开资料）

- 腾讯柠檬清理官网与产品页；CleanMyMac X 官方功能页；360 安全卫士官方功能页。
- Apple 支持文档：储存空间 / 系统数据 / Time Machine 本地快照。
- Microsoft 文档：磁盘清理、DISM `/StartComponentCleanup`、存储感知、WSL 磁盘。
- Docker 文档：`docker system prune` / `docker builder prune`。
- Ollama / Hugging Face / LM Studio 文档中的模型目录说明。
- 2025 年媒体对“Apple Intelligence 本地模型难以删除”的报道（RemoveMacAI 工具事件）。
