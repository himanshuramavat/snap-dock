import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

/**
 * Content scripts cannot be ES modules in either engine, so this one is built
 * separately as a single self-contained IIFE.
 *
 * Must not clear dist/: it runs alongside the page and background builds.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '');

  return {
    resolve: {
      alias: { '@': resolve(import.meta.dirname, 'src') },
    },
    define: {
      __SNAPDOCK_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
      __SNAPDOCK_FIREFOX_CLIENT_ID__: JSON.stringify(env.SNAPDOCK_GOOGLE_CLIENT_ID_FIREFOX ?? ''),
    },
    build: {
      outDir: resolve(import.meta.dirname, 'dist'),
      emptyOutDir: false,
      target: 'chrome116',
      sourcemap: mode === 'development',
      minify: mode !== 'development',
      lib: {
        entry: resolve(import.meta.dirname, 'src/content/region-select.ts'),
        formats: ['iife' as const],
        name: 'SnapDockRegionSelect',
        fileName: () => 'content/region-select.js',
      },
      rollupOptions: {
        output: { extend: true },
      },
    },
  };
});
