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
    // tsx — used as runtime via `npx tsx` to run the MCP server subprocess
    'tsx',
    // mdast — type-only import, types come from @types/mdast (transitive dep of remark-parse)
    'mdast',
  ],
  // Don't flag exports that are also used within the same file
  // (e.g., React Props interfaces, shared type aliases co-located with implementations)
  ignoreExportsUsedInFile: true,
};

export default config;
