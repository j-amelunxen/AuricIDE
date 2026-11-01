import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: true,
    // Transformed modules are cached on disk between runs, keyed by content.
    experimental: { fsModuleCache: true },
    // Two projects because a DOM environment costs far more than most tests
    // it hosts: for pure-logic `.ts` files, setting up jsdom took about six
    // times longer than the tests themselves. A `.ts` test that needs a DOM
    // says so with `// @vitest-environment jsdom` on its first line. Without
    // it, most fail on `document is not defined`; code that checks
    // `typeof document` instead takes its no-DOM branch, so a test mocking a
    // browser API should assert that its mock was used.
    //
    // Components (`.tsx`) run on happy-dom, which sets up in about half the
    // time. Where it parts from browsers (it keeps `#hex` colours instead of
    // normalising them to `rgb()`, makes `navigator.clipboard` read-only,
    // parses less CSS) a file stays on jsdom with the same first-line comment.
    // `pnpm test:run:jsdom` runs every component test on jsdom as a cross-check.
    projects: [
      {
        extends: true,
        test: {
          name: 'dom',
          environment: process.env.AURIC_TEST_DOM === 'jsdom' ? 'jsdom' : 'happy-dom',
          include: ['src/**/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test-setup.ts',
        'src/types/**/*',
        'src/app/favicon.ico',
      ],
    },
  },
});
