import js from '@eslint/js'
import globals from 'globals'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    ignores: ['node_modules/**', 'var/**'],
    languageOptions: {
      globals: {
        ...globals.node,
        URL: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'preserve-caught-error': 'off',
    },
  },
])
