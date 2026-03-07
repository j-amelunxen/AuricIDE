import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/lib/nlp/deepAnalysisWorker.ts'],
  project: ['src/**/*.{ts,tsx}'],
  ignoreFiles: [
    // Requirements UI components — wired into page.tsx when task #5 completes
    'src/app/components/requirements/RequirementFilterPanel.tsx',
    'src/app/components/requirements/RequirementList.tsx',
    'src/app/components/requirements/RequirementCreateDialog.tsx',
    'src/app/components/requirements/RequirementDetailPanel.tsx',
    'src/app/components/requirements/RequirementsModal.tsx',
  ],
  ignoreDependencies: [
    // Tailwind typography plugin — loaded via CSS @plugin directive, invisible to JS
    '@tailwindcss/typography',
    // tailwindcss — consumed by @tailwindcss/postcss at the CSS level, no JS import
    'tailwindcss',
    // remark-lint presets — consumed as unified plugins, not direct TS imports
    'remark-lint',
    // tsx — used as runtime via `npx tsx` to run the MCP server subprocess
    'tsx',
  ],
  // Don't flag exports that are also used within the same file
  // (e.g., React Props interfaces, shared type aliases co-located with implementations)
  ignoreExportsUsedInFile: true,
};

export default config;
