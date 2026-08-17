#!/usr/bin/env node
/**
 * Zips each build target into a store-ready package.
 *
 * Usage:  npm run package
 *
 * Two archives, because the two engines need different manifests: Chromium rejects
 * `background.scripts` under MV3 and Firefox ignores `background.service_worker`.
 * See scripts/targets.mjs.
 *
 * Each archive has manifest.json at its root, which is what both stores require. Zipping
 * the containing folder instead is the classic mistake, and both stores reject it with an
 * unhelpful message.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'web-ext-artifacts');

const TARGETS = [
  { dir: 'dist', suffix: 'chrome', store: 'Chrome Web Store  https://chrome.google.com/webstore/devconsole' },
  { dir: 'dist-firefox', suffix: 'firefox', store: 'Firefox (AMO)     https://addons.mozilla.org/developers/' },
];

async function main() {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  await mkdir(outDir, { recursive: true });

  for (const target of TARGETS) {
    const source = resolve(root, target.dir);
    if (!existsSync(resolve(source, 'manifest.json'))) {
      throw new Error(`${target.dir}/manifest.json not found. Run \`npm run build\` first.`);
    }

    const archive = resolve(outDir, `snapdock-${pkg.version}-${target.suffix}.zip`);
    await rm(archive, { force: true });
    // -r recurse, -q quiet, -X drop platform metadata that stores flag as junk.
    await run('zip', ['-rqX', archive, '.'], { cwd: source });
    console.log(`Packaged ${archive}`);
  }

  console.log('\nUpload to:');
  for (const target of TARGETS) console.log(`  ${target.store}`);
  console.log('\nSee docs/PUBLISHING.md before your first upload.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
