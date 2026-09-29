import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const pure =
  'src/domain and src/engine are pure. Pass time and randomness in. See AGENTS.md invariant 1.';

const impureGlobals = [
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB',
  'performance', 'crypto', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'setTimeout', 'setInterval', 'requestAnimationFrame',
];

export default defineConfig(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'eslint.config.js'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
  },
  { ...reactHooks.configs.flat.recommended, files: ['src/**/*.tsx'] },
  {
    files: ['e2e/**/*.ts', 'scripts/**/*.ts', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/domain/**/*.ts', 'src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...impureGlobals.map((name) => ({ name, message: pure }))],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: pure },
        { object: 'Math', property: 'random', message: pure },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: pure },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['react', 'react-dom', 'idb'].map((name) => ({ name, message: pure })),
          patterns: [{ regex: '(^|/)(data|app|worker)(/|$)', message: pure }],
        },
      ],
    },
  },
);
