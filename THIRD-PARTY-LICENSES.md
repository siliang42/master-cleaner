# 第三方组件与许可 / Third-Party Licenses

本文件列出 Master Cleaner 的运行时依赖、开发依赖，以及通过外部命令间接使用
的组件及其许可。分发本软件（含源码、打包产物、桌面安装包或前端构建产物）时，
请保留本文件。

## 运行时依赖（Runtime）

本软件的运行时**不依赖任何第三方 npm 包**：它只使用 Node.js 内置模块
（`fs`、`path`、`os`、`http`、`child_process` 等）和操作系统自带的命令。
前端仪表盘为原生 HTML/CSS/JavaScript，无第三方前端库。

- Node.js（运行时环境）— MIT 类许可，见 <https://github.com/nodejs/node/blob/main/LICENSE>

## 开发依赖（Dev Dependencies）

这些包仅在构建/类型检查时使用，不随运行时产物分发：

| 包名 | 版本范围 | 许可 | 著作权 |
| --- | --- | --- | --- |
| `typescript` | ^5.6.0 | Apache-2.0 | Copyright (c) Microsoft Corporation |
| `@types/node` | ^22.7.0 | MIT | Copyright (c) DefinitelyTyped contributors |

## 外部命令（External Commands）

部分模块通过调用系统或环境中的外部命令完成清理（例如容器镜像/缓存清理）。
这些工具受其**各自**的许可与条款约束，本项目的许可不涵盖它们，本项目也不
分发它们。常见示例：

- Docker / Podman（容器清理）— Apache-2.0 / Apache-2.0
- Homebrew（macOS，部分清理路径）— BSD-2-Clause
- Git、npm、Node 工具链 — 各自许可

调用外部命令前，请确认其许可与你所在环境的合规要求。

## 文本与标准

- GNU Affero General Public License v3.0 全文：见 [LICENSE](./LICENSE)
