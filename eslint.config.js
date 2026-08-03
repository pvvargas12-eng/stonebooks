import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Sprint J1-P1 stabilization: narrow the deploy gate to hook-order
    // safety only. The codebase has 12+ sprints of legacy patterns that
    // pre-date these v7 rules (set-state-in-effect, immutability, refs)
    // and routine cleanup hygiene (no-unused-vars, no-undef). Cleaning
    // them is a separate sprint, not part of stabilization. The single
    // rule we care about for deploy safety — react-hooks/rules-of-hooks
    // — stays at error; everything else is informational until we
    // explicitly decide to address it.
    //
    // no-undef is an ERROR as of 2026-08-03: a missing import shipped a
    // render crash to prod (OrderDetail, properName) because warn-level lint
    // let it through — and the sweep found two more latent ones (SalesMode
    // rankDiversify, reportDefs orderName). Node files get their own globals
    // block below so process/Buffer/__dirname stop false-positive.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      // Additional pre-existing legacy patterns flagged by js.configs.recommended:
      // empty catch blocks (common error-swallow pattern across sprints) and
      // an isolated useless-assignment. Same downgrade rationale as above.
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  // Node contexts — Vercel api routes, CLI scripts, root config files. These
  // run under Node, so its globals are real here, keeping no-undef honest.
  {
    files: ['api/**/*.js', 'scripts/**/*.{js,mjs}', '*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
