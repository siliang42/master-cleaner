/**
 * Single source of truth for legal, licensing and attribution metadata.
 *
 * The CLI (`mc legal`, `--version`) and the local dashboard both read from here
 * so the license notice, attribution and disclaimer stay consistent across
 * every surface.
 *
 * NOTE: `projectUrl` is a placeholder. Replace it with the real public
 * repository URL before publishing; the AGPLv3 Section 7 attribution terms
 * point users at it.
 */

export const LEGAL = {
  productName: 'Master Cleaner',
  packageName: 'master-cleaner',
  version: '1.1.0',
  copyrightYear: 2026,
  copyrightHolder: 'Johnny',
  contactEmail: 'obanie@qq.com',
  /** TODO: replace with the real public repository URL before release. */
  projectUrl: 'https://github.com/siliang42/master-cleaner',
  licenseId: 'AGPL-3.0-only',
  licenseName: 'GNU Affero General Public License v3.0',
  attributionNotice: 'Designed and developed by the Master Cleaner authors and contributors.',
} as const;

export function copyrightLine(): string {
  return `Copyright (C) ${LEGAL.copyrightYear} ${LEGAL.copyrightHolder} <${LEGAL.contactEmail}> and contributors.`;
}

export function versionLine(): string {
  return `${LEGAL.productName} v${LEGAL.version}`;
}

export function licenseBanner(): string {
  return `${versionLine()} · ${LEGAL.licenseName} (${LEGAL.licenseId})`;
}

/** Short disclaimer shown by the CLI and dashboard. Full text lives in DISCLAIMER.md. */
export const DISCLAIMER_SUMMARY: readonly string[] = [
  '本软件会移动或删除文件（其中"永久删除"不可恢复），并可能执行外部清理命令。',
  '清理前请务必自行备份，并优先使用演练模式（--dry-run）核对。',
  '本软件按"现状"提供，不附带任何担保；作者与贡献者不对数据丢失或其它损害承担责任。',
  '完整条款见 DISCLAIMER.md 与 LICENSE。',
];

/** Attribution block that modified versions must preserve under AGPLv3 Section 7. */
export function attributionBlock(): string {
  return [LEGAL.attributionNotice, copyrightLine()].join('\n');
}

/** Full legal notice text, used by `mc legal` and the `/api/legal` endpoint. */
export function legalText(): string {
  return [
    licenseBanner(),
    '',
    copyrightLine(),
    '',
    `License: ${LEGAL.licenseName} (${LEGAL.licenseId})`,
    'Additional terms under AGPLv3 Section 7 require modified versions to',
    'preserve the attribution notice below and to keep a visible link to the',
    'original project:',
    '',
    attributionBlock(),
    `Project: ${LEGAL.projectUrl}`,
    `Contact: ${LEGAL.contactEmail}`,
    '',
    '免责声明 / Disclaimer',
    ...DISCLAIMER_SUMMARY.map((l) => `  - ${l}`),
  ].join('\n');
}
