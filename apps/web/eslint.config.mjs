import { defineConfig } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Flat config on ESLint 9 (Next 16 removed `next lint`). Both presets export
// arrays of flat-config objects, verified against the installed
// eslint-config-next@16.3.6 dist (`export = Linter.Config[]`), and they already
// include global ignores for `.next/**`, `out/**`, `build/**` and
// `next-env.d.ts`, plus the typescript-eslint parser/plugin (bundled).
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Downgraded to warn, not off: the flagged effects are deliberate,
      // documented behaviors (localStorage hydration sync, capability
      // fallbacks, load/validate pipelines) whose "compliant" rewrites are
      // behavioral refactors, out of scope for lint modernization.
      'react-hooks/set-state-in-effect': 'warn',
      // Advisory only: this project does not run the React Compiler, so a
      // skipped compilation of existing manual memoization is not a defect.
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  {
    // Scoped to tests only (dual-review R1): the destructure-and-omit idiom
    // (`const { x: _omitted, ...rest }`) and underscore-prefixed placeholders
    // are intentional THERE, while app code keeps the preset defaults.
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { ignoreRestSiblings: true, varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
]);
