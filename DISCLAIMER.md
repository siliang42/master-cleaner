# 免责声明 · Disclaimer

本免责声明（下称"本声明"）是 Master Cleaner 项目（下称"本软件"）法律文件的
组成部分，与 [LICENSE](./LICENSE)（AGPL-3.0-only）、[NOTICE](./NOTICE) 及
[THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md) 共同构成完整约定。你
下载、安装、复制、运行或以任何方式使用本软件，或基于本软件创作衍生作品，
即视为你已阅读、理解并接受本声明全部内容。如果你不同意，请勿使用本软件。

> 本声明以通俗语言说明风险，但不构成、也不应被理解为法律意见。若你需要在
> 受监管、合规或商业敏感的环境中使用本软件，请就你的具体情形咨询具备相应
> 资质的执业律师。本声明的英文版本与中文版本如有歧义，以英文版本及 AGPLv3
> 原文为准。

## 1. 无担保（按"现状"提供）

在适用法律允许的最大范围内，本软件按"现状"（AS IS）及"现有"（AS AVAILABLE）
提供，不附带任何形式的明示或默示担保，包括但不限于对适销性、特定用途适用性、
所有权、不侵权、准确性、无病毒或无误运行的担保。AGPLv3 第 15 条与第 16 条
同样排除担保并限制责任。作者与贡献者不保证本软件无缺陷、不中断、或能实现
任何特定结果。

## 2. 数据删除与不可逆损失风险（核心风险）

本软件是一个磁盘清理与优化工具，其功能本质是移动或删除文件：

- "安全回收站（quarantine）"会将文件移入本软件自有的可还原仓库；
- "系统回收站（trash）"会将文件移入操作系统回收站；
- "永久删除（delete）"会不可恢复地删除文件；
- 部分模块通过执行外部命令进行清理（例如容器镜像/缓存的清理），此类操作
  同样可能不可逆。

你必须在执行任何清理前自行完成充分备份，并在正式执行前使用演练模式
（dry-run）核对将被处理的条目。因使用本软件而导致的任何数据丢失、数据损坏、
误删、无法恢复、业务中断、生产环境故障、利润或收入损失、商誉损失或其他
损害，无论其如何引起，作者与贡献者均不承担任何责任。是否清理、清理哪些
项目、采用何种模式、以及是否以管理员/root 权限运行，完全由你自行判断并承担
全部后果。

## 3. 扫描结果的准确性

本软件的扫描结果、模块风险分级与"AI 残留"识别基于启发式规则与静态判断，
可能存在误报（将不应清理的内容标记为可清理）或漏报。扫描结果仅供参考，
不构成任何专业建议，你应自行核实后再做决定。

## 4. 隐私与数据本地性

本软件设计为在本地运行：文件系统扫描读取的是文件名、大小、时间等元数据，
本软件本身不会将你的数据上传至作者或任何第三方。随附的本地仪表盘默认仅
绑定本地回环地址（127.0.0.1）。但你应知悉：

- 扫描与日志可能记录包含敏感信息的文件路径或名称，请妥善保管数据目录与日志；
- 若你自行更改绑定地址、将仪表盘暴露到网络、或在其上运行第三方模块，
  由此产生的数据暴露与安全风险由你自行承担。

## 5. 合规使用义务

你同意仅将本软件用于合法目的，并且不会：

- 使用本软件销毁、篡改依据法律法规、监管要求、诉讼保全、审计或合规义务
  必须保留的数据；
- 使用本软件妨碍、规避或破坏取证、调查、审计或安全事件的证据保全；
- 违反任何适用法律、法规或对你具有约束力的合同义务。

因你的违规使用而产生的任何责任与损失，由你自行承担。

## 6. 非专业建议

本软件及其文档不构成法律、财务、税务、医疗、信息安全或其他专业领域的建议。
你不应将其作为作出重大决策的唯一依据。

## 7. 商标与名称

本声明及 AGPLv3 均不授予你对本项目名称、标识、商标或产品名称的任何权利，
第 7(d) 条下的有限使用除外。你不得以暗示背书、赞助或关联的方式使用这些名称。

## 8. 第三方组件与外部服务

本软件可能包含或以外部命令的方式调用第三方组件、工具或服务（例如系统命令、
容器运行时等）。这些组件适用其各自的许可与条款，见
[THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md)。作者与贡献者不对第三方
组件的行为、许可、可用性或安全性负责。

## 9. 出口与制裁合规

你应遵守适用的出口管制与经济制裁法律法规，不得在受制裁的国家或地区、或向
受限制的最终用户，以违反相关法律的方式使用或分发本软件。

## 10. 责任限制

在适用法律允许的最大范围内，对于因本软件或与本软件相关而产生的任何间接的、
附带的、特殊的、惩罚性的或后果性的损害，包括数据丢失、利润损失、业务中断
或替代服务的成本，作者与贡献者在任何情况下均不承担责任；即使已被告知此类
损害的可能性亦同。由于本软件以免费开源方式提供，作者与贡献者对你的累计责任
总额以你为本软件实际支付的金额（如有，且通常为零）为上限。本条不排除适用
法律下不可排除或限制的责任。

## 11. 赔偿

你同意就以下事项引起的任何索赔、损害、责任、损失与费用（包括合理的律师费），
向作者与贡献者作出赔偿并使其免受损害：(a) 你违反本声明或任何适用法律；
或 (b) 你使用、修改、分发本软件的行为所引发的第三方索赔。

## 12. 适用法律与争议解决

本声明与 AGPLv3 的适用法律、管辖法院与争议解决方式，依 AGPLv3 及相关法律
确定。就与 AGPLv3 直接相关的事项，以其条款为准。项目维护者可另行说明其
所在地的适用法律；在此之前，请以 AGPLv3 原文及适用法律为准。

## 13. 变更与可分性

项目维护者可随时更新本声明，最新版本以仓库中的本文件为准，恕不另行个别通知。
若本声明任何条款被认定为无效或不可执行，其余条款仍继续有效，并在最大可能
范围内实现原条款的意图。

---

# Disclaimer

This Disclaimer (the "Disclaimer") is part of the legal documentation of the
Master Cleaner project (the "Software") and, together with LICENSE
(AGPL-3.0-only), NOTICE and THIRD-PARTY-LICENSES.md, forms the complete
agreement. By downloading, installing, copying, running, or otherwise using the
Software, or by creating a derivative work based on it, you acknowledge that you
have read, understood, and accepted this Disclaimer in full. If you do not
agree, do not use the Software.

This text explains risk in plain language but is not, and must not be construed
as, legal advice. For use in regulated, compliance-sensitive, or
business-critical environments, consult a qualified lawyer about your specific
situation. If there is any ambiguity between the English and Chinese versions,
the English version and the AGPLv3 text control.

## 1. No Warranty (Provided "AS IS")

To the maximum extent permitted by applicable law, the Software is provided "AS
IS" and "AS AVAILABLE", without warranty of any kind, express or implied,
including but not limited to the warranties of merchantability, fitness for a
particular purpose, title, non-infringement, accuracy, and freedom from viruses
or error-free operation. AGPLv3 Sections 15 and 16 also disclaim warranties and
limit liability. The authors and contributors do not warrant that the Software
will be defect-free, uninterrupted, or fit for any purpose.

## 2. Data Deletion and Irreversible Loss (Core Risk)

The Software is a disk cleaning and optimization tool whose function is, by
nature, to move or delete files:

- "quarantine" moves files into the Software's own recoverable store;
- "trash" moves files into the operating system recycle bin;
- "delete" permanently and irreversibly deletes files;
- some modules clean by executing external commands (for example container
  image/cache pruning), which may also be irreversible.

You must make sufficient backups before cleaning, and use dry-run mode to review
the items that would be affected before executing. The authors and contributors
accept no liability for any data loss, data corruption, accidental deletion,
loss of recoverability, business interruption, production failure, loss of
profit or revenue, loss of goodwill, or other damage arising from your use of
the Software, however caused. Whether to clean, which items to clean, which mode
to use, and whether to run with administrative/root privileges are decisions
you make and for which you bear all consequences.

## 3. Accuracy of Scan Results

Scan results, risk grading, and "AI-residue" detection are based on heuristics
and static analysis and may be wrong (false positives that mark real data as
cleanable, or false negatives). Results are for reference only and do not
constitute professional advice; verify before you act.

## 4. Privacy and Data Locality

The Software is designed to run locally: filesystem scans read metadata such as
file names, sizes, and timestamps, and the Software itself does not upload your
data to the authors or any third party. The bundled dashboard binds to the
localhost loopback interface (127.0.0.1) by default. You should be aware that:

- scans and logs may record file paths or names containing sensitive
  information, so protect the data directory and logs accordingly;
- if you change the bind address, expose the dashboard to a network, or run
  third-party modules, you bear the resulting data-exposure and security risk.

## 5. Lawful Use

You agree to use the Software only for lawful purposes and will not: (a) use it
to destroy or alter data that must be retained under law, regulation, litigation
hold, audit, or compliance obligations; (b) use it to obstruct, evade, or
undermine evidence preservation in forensics, investigations, audits, or
security incidents; or (c) violate any applicable law, regulation, or
contractual obligation binding on you. You bear all liability arising from
misuse.

## 6. Not Professional Advice

The Software and its documentation do not constitute legal, financial, tax,
medical, information-security, or other professional advice, and should not be
the sole basis for any significant decision.

## 7. Trademarks and Names

Neither this Disclaimer nor AGPLv3 grants you any right to use the project name,
logos, trademarks, or product names, except the limited use permitted by Section
7(d). You may not use them in a way implying endorsement, sponsorship, or
affiliation.

## 8. Third-Party Components and External Services

The Software may include or invoke third-party components, tools, or services
(for example system commands or container runtimes). Those are governed by their
own licenses and terms, listed in THIRD-PARTY-LICENSES.md. The authors and
contributors are not responsible for the behavior, licensing, availability, or
security of third-party components.

## 9. Export and Sanctions Compliance

You must comply with applicable export-control and economic-sanctions laws and
must not use or distribute the Software in violation of those laws, including in
sanctioned countries or regions or to restricted end users.

## 10. Limitation of Liability

To the maximum extent permitted by applicable law, in no event will the authors
or contributors be liable for any indirect, incidental, special, punitive, or
consequential damages, including data loss, loss of profit, business
interruption, or the cost of substitute services, arising out of or related to
the Software, even if advised of the possibility of such damages. Because the
Software is provided free of charge and open source, the authors' and
contributors' total aggregate liability to you is limited to the amount you
actually paid for the Software (if any, and typically zero). This section does
not exclude or limit liability that cannot be excluded or limited under
applicable law.

## 11. Indemnification

You agree to indemnify and hold harmless the authors and contributors from and
against any claims, damages, liabilities, losses, and expenses (including
reasonable attorneys' fees) arising from: (a) your breach of this Disclaimer or
any applicable law; or (b) third-party claims arising from your use,
modification, or distribution of the Software.

## 12. Governing Law and Disputes

The governing law, venue, and dispute-resolution mechanism for this Disclaimer
and AGPLv3 are determined by AGPLv3 and applicable law. For matters directly
governed by AGPLv3, its terms control. The maintainers may designate their
applicable law; until then, AGPLv3 and applicable law govern.

## 13. Changes and Severability

The maintainers may update this Disclaimer at any time; the current version in
the repository controls and no individual notice will be given. If any provision
is held invalid or unenforceable, the remaining provisions remain in effect and
the original intent will be given effect to the greatest extent possible.

---

联系方式 / Contact: obanie@qq.com
