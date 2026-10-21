'use strict';

/**
 * Install the packaged macOS build into /Applications and keep a single
 * runnable copy on the machine.
 *
 * Multiple copies (release/mac-universal, a mounted DMG, an unzipped download)
 * are separate TCC identities, so each of them asks for folder permissions
 * again. This script replaces /Applications/Master Cleaner.app with the freshly
 * built bundle, removes the build-tree copy, and verifies the ad-hoc signature.
 *
 * Usage: npm run install:mac   (packages first) or node scripts/install-mac.js
 *        --keep-build          keep release/mac-universal after installing
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { adhocSign, findAppIn, inspect, BUNDLE_ID } = require('./adhoc-sign.js');

const repoRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(repoRoot, 'release');
const buildDir = path.join(releaseDir, 'mac-universal');
const destination = '/Applications/Master Cleaner.app';
const keepBuild = process.argv.includes('--keep-build');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}):\n${r.stderr || r.stdout || ''}`.trim());
  }
  return r;
}

function fail(message) {
  console.error(`[install-mac] ${message}`);
  process.exit(1);
}

function isRunning() {
  const r = spawnSync('pgrep', ['-f', 'Master Cleaner.app/Contents/MacOS/Master Cleaner'], { encoding: 'utf8' });
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}

function main() {
  if (process.platform !== 'darwin') fail('macOS only.');

  let source;
  try {
    source = findAppIn(buildDir);
  } catch (err) {
    fail(`${err.message}\nRun "npm run dist:mac" first, or use "npm run install:mac".`);
  }

  let info = inspect(source);
  if (info.identifier !== BUNDLE_ID || !info.bound || !info.sealed) {
    console.log('[install-mac] build is not fully ad-hoc signed yet; signing it now');
    info = adhocSign(source);
  }

  if (isRunning()) {
    fail('Master Cleaner is running. Quit it from the menu-bar icon, then run this command again.');
  }

  const stamp = Date.now();
  const staged = `/Applications/.master-cleaner-stage-${stamp}.app`;
  const previous = `/Applications/.master-cleaner-previous-${stamp}.app`;

  console.log(`[install-mac] installing ${source} -> ${destination}`);
  try {
    run('ditto', [source, staged]);
  } catch (err) {
    fail(`copying the build into /Applications failed: ${err.message}`);
  }

  let movedPrevious = false;
  try {
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, previous);
      movedPrevious = true;
    }
    fs.renameSync(staged, destination);
  } catch (err) {
    if (movedPrevious && !fs.existsSync(destination) && fs.existsSync(previous)) {
      fs.renameSync(previous, destination);
    }
    if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true, force: true });
    fail(`replacing ${destination} failed: ${err.message}`);
  }

  const installed = inspect(destination);
  if (installed.identifier !== BUNDLE_ID || !installed.bound) {
    fail(`installed copy failed verification (Identifier=${installed.identifier}, Info.plist bound=${installed.bound}).`);
  }
  try {
    run('codesign', ['--verify', '--deep', '--strict', destination]);
  } catch (err) {
    fail(`codesign verification failed on the installed copy: ${err.message}`);
  }
  if (movedPrevious) fs.rmSync(previous, { recursive: true, force: true });

  if (!keepBuild) {
    for (const name of ['mac-universal', 'mac-arm64', 'mac']) {
      const dir = path.join(releaseDir, name);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`[install-mac] removed build copy ${dir}`);
      }
    }
  }

  console.log(`[install-mac] installed: ${destination}`);
  console.log(`[install-mac] signature: ad-hoc, Identifier=${installed.identifier}`);
  console.log('[install-mac] launching this build for the first time asks once per protected folder (Documents/Desktop/Downloads/...).');
  console.log('[install-mac] details: "macOS signing & folder permissions" in README.md');
}

main();
