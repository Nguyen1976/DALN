import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // React Compiler hints. They point at code the compiler cannot optimise
      // — a loading flag set inside a data-fetching effect, a manual useCallback
      // whose dependency list it would infer differently. Worth seeing, but not
      // worth blocking a deploy over: they flag ordinary, correct React.
      // Everything else stays an error so CI can gate on real problems.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  {
    // shadcn-style primitives deliberately export a component next to its
    // variants helper or context hook. The Fast Refresh rule wants one export
    // per file, which would mean splitting every primitive in two.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Animate UI code copied in by the shadcn CLI. Each icon exports its
    // `animations` table next to the component, and Slot wraps its child in
    // motion.create() inside useMemo by design. Kept as shipped so updates
    // from the registry stay a clean overwrite.
    files: ['src/components/animate-ui/**/*.{ts,tsx}', 'src/hooks/use-is-in-view.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/static-components': 'off',
    },
  },
])
