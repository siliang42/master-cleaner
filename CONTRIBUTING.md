# 贡献指南 / Contributing

感谢你愿意为 Master Cleaner 做出贡献。提交贡献前，请阅读以下约定。

## 入站贡献许可

依据本项目的许可模式，任何你提交并被合并的贡献（代码、文档、资源等）将被
视为以 [AGPL-3.0-only](./LICENSE) 授权给本项目及所有下游用户。请勿提交你
无权以该许可授权的代码或资源。

为明确这一点，请在提交信息中使用 Developer Certificate of Origin（DCO）
sign-off：

```bash
git commit -s -m "fix: ..."
```

sign-off 行形如 `Signed-off-by: Your Name <you@example.com>`，表示你证明有权
按上述许可提交该贡献，并同意遵守 [DCO](https://developercertificate.org/)。

## 署名与法务文件

- 请勿移除或弱化 `LICENSE`、`NOTICE`、`DISCLAIMER.md`、`SECURITY.md`、
  `THIRD-PARTY-LICENSES.md` 中的版权、署名、免责与许可信息。
- 新增依赖前请确认其许可与 AGPL-3.0-only 兼容，并同步更新
  [THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md)。
- 涉及删除或移动文件的改动，必须经过安全层（`src/core/safety.ts`）校验。

## 开发流程

```bash
npm install
npm run typecheck      # 类型检查
npm run build          # 构建 dist/
```

- 使用与现有代码一致的风格；改动尽量聚焦、可审阅。
- 提交信息建议采用 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` 等）。
- 涉及行为的改动请附上说明或测试；扫描/清理相关的改动请说明其风险等级与
  默认勾选策略。

## 行为准则

请保持专业与尊重。骚扰、歧视或攻击性言行不被接受。

## 安全性问题

安全漏洞请勿公开提交，按 [SECURITY.md](./SECURITY.md) 私下报告。
