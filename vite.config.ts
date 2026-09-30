import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // three.js alone is ~895 kB minified (~245 kB gzip) and cannot be split
    // further; the limit only silences the warning for that one vendor chunk.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        // three.js lives in its own long-lived chunk so game-code changes do
        // not invalidate its cache. The chunk-generation worker never imports
        // three, so it stays a separate, independent bundle.
        codeSplitting: {
          groups: [{ name: 'vendor-three', test: /node_modules.three./ }],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
