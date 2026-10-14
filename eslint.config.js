import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/target', '.parity', 'prototype', 'reference'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  // the reference tooling predates the lint setup; keep it untouched and only warn
  { files: ['tools/**'], rules: { '@typescript-eslint/no-unused-vars': 'warn' } },
);
