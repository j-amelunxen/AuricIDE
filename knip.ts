import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/lib/nlp/deepAnalysisWorker.ts'],
  project: ['src/**/*.{ts,tsx}'],
  ignoreDependencies: [
    // Tailwind typography plugin — loaded via CSS @plugin directive, invisible to JS
    '@tailwindcss/typography',
    // tailwindcss — consumed by @tailwindcss/postcss at the CSS level, no JS import
    'tailwindcss',
    // remark-lint presets — consumed as unified plugins, not direct TS imports
    'remark-lint',
    // bun — the pinned bundler is launched by absolute path from scripts/build-mcp-runtime.mjs
    'bun',
    // WDIO loads these through its CLI/configuration at runtime rather than TS imports.
    '@wdio/cli',
    '@wdio/local-runner',
    '@wdio/mocha-framework',
    '@wdio/tauri-service',
  ],
  // Don't flag exports that are also used within the same file
  // (e.g., React Props interfaces, shared type aliases co-located with implementations)
  ignoreExportsUsedInFile: true,
};

export default config;
