import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

/**
 * The background bundle is built on its own, as a single self-contained ES module.
 *
 * Chromium loads it as a module service worker and Firefox as a module event page. Both
 * cope with static imports, but a background split across shared chunks is one more
 * thing that has to resolve identically in two engines for no benefit, so
 * `inlineDynamicImports` keeps it to one file.
 *
 * Must not clear dist/: it runs alongside the page and content-script builds.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '');

  return {
    resolve: {
      alias: { '@': resolve(import.meta.dirname, 'src') },
    },
    define: {
      __SNAPDOCK_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
      // Firefox has no `oauth2` manifest key, so its client id is compiled in.
      __SNAPDOCK_FIREFOX_CLIENT_ID__: JSON.stringify(env.SNAPDOCK_GOOGLE_CLIENT_ID_FIREFOX ?? ''),
    },
    build: {
      outDir: resolve(import.meta.dirname, 'dist'),
      emptyOutDir: false,
      target: 'chrome116',
      sourcemap: mode === 'development',
      minify: mode !== 'development',
      lib: {
        entry: resolve(import.meta.dirname, 'src/background/index.ts'),
        formats: ['es' as const],
        fileName: () => 'assets/background.js',
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  };
});
