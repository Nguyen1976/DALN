// @ts-check
import eslint from '@eslint/js'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// `import ... assert { type: 'json' }` was removed in Node 22 (it became
// `with`), which made this config fail to load at all — that is why backend
// lint has been silently unrunnable. Reading the file directly works on every
// Node version the project targets; `require` does not, because `.prettierrc`
// has no `.json` extension for CommonJS to key off.
const prettierConfig = JSON.parse(
  readFileSync(new URL('.prettierrc', import.meta.url), 'utf8'),
)
void fileURLToPath

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      // Prisma client output. It is generated on every build, gitignored, and
      // accounted for 26k of the 27k lint errors — linting it says nothing
      // about code anyone writes.
      '**/generated/**',
      'dist/**',
      'node_modules/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { ...prettierConfig, endOfLine: 'auto' }],
    },
  },
)
