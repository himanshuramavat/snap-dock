#!/usr/bin/env node
/**
 * Mirrors the built Chromium output into a Firefox target.
 *
 * Run automatically by `npm run build`, after the three Vite passes.
 *
 * Why two output folders rather than one manifest with both keys: Chromium *rejects*
 * `background.scripts` under Manifest V3 ("requires manifest version of 2 or lower"),
 * and Firefox ignores `background.service_worker`. There is no spelling of that key that
 * both engines accept, so each target gets its own manifest.
 *
 * Everything else is byte-identical. Only manifest.json differs, which is exactly the
 * property that makes this safe: there is one bundle, built once, and no chance of the
 * two targets drifting in behaviour.
 *
 * Chromium stays in dist/ so "Load unpacked -> dist" keeps working, and Firefox is a
 * sibling folder rather than a subfolder: nesting it inside dist/ would sweep a second
 * manifest.json into the Chromium package.
 */

import { cp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildManifest } from '../src/manifest.config.ts';

const root = resolve(import.meta.dirname, '..');
const chromeDir = resolve(root, 'dist');
const firefoxDir = resolve(root, 'dist-firefox');

/**
 * Reads a build-time variable the same way Vite's loadEnv does, so the generated Firefox
 * manifest matches the one the Chromium build produced.
 */
async function readEnv(name) {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const text = await readFile(path, 'utf8');
    for (const line of text.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && match[1] === name) return match[2].replace(/^["']|["']$/g, '');
    }
  }
  return process.env[name] ?? '';
}

async function main() {
  if (!existsSync(resolve(chromeDir, 'manifest.json'))) {
    throw new Error('dist/manifest.json not found. Run the Vite builds first.');
  }

  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

  await rm(firefoxDir, { recursive: true, force: true });
  await mkdir(firefoxDir, { recursive: true });
  await cp(chromeDir, firefoxDir, { recursive: true });

  const manifest = buildManifest({
    target: 'firefox',
    googleClientId: await readEnv('SNAPDOCK_GOOGLE_CLIENT_ID'),
    version: pkg.version,
  });

  await writeFile(
    resolve(firefoxDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log('Load unpacked:');
  console.log('  dist           Chrome, Edge, Brave, Opera, Vivaldi');
  console.log('  dist-firefox   Firefox');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
