'use strict';

/**
 * Ad-hoc code signing for the packaged macOS app.
 *
 * Why: macOS records folder-access grants (TCC) against the app's code
 * signature. Without a Developer ID certificate electron-builder skips signing
 * entirely, so the bundle keeps only the upstream linker-level ad-hoc signature
 * (`Identifier=Electron`, `Info.plist=not bound`) and tccd has no stable
 * identity to store "Allow" against - Documents/Desktop/Downloads are asked
 * again on every scan.
 *
 * Signing the finished bundle binds Info.plist and gives the app a real bundle
 * identity for this build. Ad-hoc signatures embed the CDHash in the designated
 * requirement, so a *new* build still requires one fresh grant; see the
 * "macOS signing & folder permissions" section in README.md.
 *
 * Set MC_SKIP_ADHOC_SIGN=1 to disable this once Developer ID signing lands.
 *
 * Used both as an electron-builder `mac.afterPack` hook and as a CLI:
 *   node scripts/adhoc-sign.js [path/to/app-or-dir]
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUNDLE_ID = 'cc.ebonex.master-cleaner';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}):\n${r.stderr || r.stdout || ''}`.trim());
  }
  return r;
}

function findAppIn(dir) {
  if (!fs.existsSync(dir)) throw new Error(`directory not found: ${dir}`);
  const apps = fs.readdirSync(dir).filter((name) => name.endsWith('.app'));
  if (apps.length !== 1) {
    throw new Error(`expected exactly one .app in ${dir}, found ${apps.length}`);
  }
  return path.join(dir, apps[0]);
}

function inspect(appPath) {
  const r = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const lines = out.split('\n');
  const pick = (prefix) => lines.find((line) => line.startsWith(prefix)) || null;
  const identifier = (out.match(/^Identifier=(.+)$/m) || [])[1];
  const signature = (out.match(/^Signature=(.+)$/m) || [])[1];

  return {
    out,
    identifier: identifier ? identifier.trim() : null,
    signature: signature ? signature.trim() : null,
    infoPlistLine: pick('Info.plist'),
    sealedLine: pick('Sealed Resources'),
    requirementsLine: pick('Internal requirements'),
    bound: !/^Info\.plist=not bound$/m.test(out),
    sealed: !/^Sealed Resources=none$/m.test(out),
    hasRequirements: !/^Internal requirements=none$/m.test(out),
  };
}

function adhocSign(appPath, { quiet = false } = {}) {
  if (!fs.existsSync(appPath)) throw new Error(`app bundle not found: ${appPath}`);
  if (!quiet) console.log(`[adhoc-sign] signing ${appPath}`);

  run('codesign', ['--force', '--deep', '--sign', '-', appPath]);

  const info = inspect(appPath);
  const problems = [];
  if (info.identifier !== BUNDLE_ID) problems.push(`Identifier=${info.identifier} (expected ${BUNDLE_ID})`);
  if (!info.bound) problems.push('Info.plist is still not bound');
  if (!info.sealed) problems.push('resources are not sealed');
  if (!info.hasRequirements) problems.push('no designated requirement was generated');
  if (problems.length) {
    throw new Error(`ad-hoc signature is incomplete:\n  - ${problems.join('\n  - ')}`);
  }

  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  return info;
}

function describe(info) {
  return `${info.identifier} (${info.signature}), ${info.infoPlistLine}, ${info.sealedLine}`;
}

async function afterPack(context) {
  if (process.env.MC_SKIP_ADHOC_SIGN === '1') {
    console.log('[adhoc-sign] skipped: MC_SKIP_ADHOC_SIGN=1');
    return;
  }
  if (context.electronPlatformName !== 'darwin') return;
  // Universal builds pack x64/arm64 into throwaway `*-temp` dirs first and merge
  // them afterwards; only the merged bundle needs a signature.
  if (/-temp$/.test(context.appOutDir)) return;

  const appPath = findAppIn(context.appOutDir);
  const info = adhocSign(appPath);
  console.log(`[adhoc-sign] ok: ${describe(info)}`);
}

module.exports = afterPack;
module.exports.adhocSign = adhocSign;
module.exports.inspect = inspect;
module.exports.findAppIn = findAppIn;
module.exports.BUNDLE_ID = BUNDLE_ID;

if (require.main === module) {
  const target = process.argv[2] || path.join(__dirname, '..', 'release', 'mac-universal');
  const appPath = target.endsWith('.app') ? target : findAppIn(target);
  const info = adhocSign(appPath);
  console.log(`[adhoc-sign] ok: ${describe(info)}`);
}
