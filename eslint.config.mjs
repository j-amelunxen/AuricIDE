import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Unused variables/imports → error (blocks commit)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Unused expressions → error
      '@typescript-eslint/no-unused-expressions': 'error',
      // Enforce === over == (no implicit type coercion)
      eqeqeq: ['error', 'always'],
      // The browser's modal dialogs are unusable here. Inside the Tauri webview
      // confirm() shows its dialog without pausing the script, so a gate built
      // on it runs the destructive action before the user has answered — the
      // click never reaches the decision. useConfirm() awaits a real answer.
      'no-restricted-globals': [
        'error',
        {
          name: 'confirm',
          message:
            'Use useConfirm() from @/lib/hooks/useConfirm — confirm() does not block in Tauri.',
        },
        {
          name: 'alert',
          message: 'Use the toast store (showToast) — alert() does not block in Tauri.',
        },
        {
          name: 'prompt',
          message: 'Use an in-app dialog — prompt() does not block in Tauri.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'confirm',
          message:
            'Use useConfirm() from @/lib/hooks/useConfirm — confirm() does not block in Tauri.',
        },
        {
          object: 'window',
          property: 'alert',
          message: 'Use the toast store (showToast) — alert() does not block in Tauri.',
        },
        {
          object: 'window',
          property: 'prompt',
          message: 'Use an in-app dialog — prompt() does not block in Tauri.',
        },
      ],
    },
  },
  prettier,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src-tauri/**', 'stitch_*/**']),
]);

export default eslintConfig;
