import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildManifest } from './src/manifest.config.ts';

const root = resolve(import.meta.dirname, 'src');
/*
 * Chromium builds straight into dist/, so "load unpacked -> dist" keeps working.
 * dist-firefox/ is mirrored from it afterwards by scripts/targets.mjs, as a sibling
 * rather than a subfolder: a nested second manifest.json would be swept into the
 * Chromium package.
 */
const outDir = resolve(import.meta.dirname, 'dist');

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
  version: string;
};

/**
 * Emits manifest.json from src/manifest.config.ts, injecting build-time configuration.
 * The Google client id is public by design (it is visible in the shipped manifest), but
 * it is still kept out of the repository so each developer uses their own Cloud project.
 */
function manifestPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'snapdock:manifest',
    apply: 'build',
    generateBundle() {
      const googleClientId = env.SNAPDOCK_GOOGLE_CLIENT_ID ?? '';
      if (!googleClientId) {
        this.warn(
          'SNAPDOCK_GOOGLE_CLIENT_ID is not set. The build will succeed, but Google Drive ' +
            'sign-in will fail until you copy .env.example to .env and fill it in. ' +
            'See docs/GOOGLE_OAUTH_SETUP.md.',
        );
      }
      const manifest = buildManifest({
        target: 'chromium',
        googleClientId,
        extensionKey: env.SNAPDOCK_EXTENSION_KEY || undefined,
        version: pkg.version,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Prefix '' so plain (non-VITE_) variable names are read from .env files.
  const env = loadEnv(mode, import.meta.dirname, '');

  return {
    root,
    publicDir: resolve(import.meta.dirname, 'public'),
    resolve: {
      alias: { '@': root },
    },
    plugins: [react(), manifestPlugin(env)],
    build: {
      outDir,
      emptyOutDir: true,
      target: 'chrome116',
      sourcemap: mode === 'development',
      minify: mode !== 'development',
      rollupOptions: {
        input: {
          popup: resolve(root, 'popup/popup.html'),
          options: resolve(root, 'options/options.html'),
          offscreen: resolve(root, 'offscreen/offscreen.html'),
        },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
    define: {
      __SNAPDOCK_VERSION__: JSON.stringify(pkg.version),
      // Firefox has no `oauth2` manifest key, so its client id is compiled in.
      __SNAPDOCK_FIREFOX_CLIENT_ID__: JSON.stringify(env.SNAPDOCK_GOOGLE_CLIENT_ID_FIREFOX ?? ''),
    },
  };
});
