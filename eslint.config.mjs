import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /*
     * Vendored OSIRIS code (from carbon-evolution/osiris, MIT) kept at
     * upstream's own lint level rather than rewritten to PolicyOS's.
     *
     * `no-explicit-any` fires 243 times in exactly the six files upstream
     * lists on its own cleanup ratchet (where it is downgraded to a warning);
     * the two next/react warnings are upstream's too. PolicyOS runs
     * `eslint --max-warnings 0`, so a warning here would fail the build the
     * same as an error, and retyping 33k lines of third-party code is a far
     * larger change than the merge itself — and one that would make every
     * future upstream sync a manual merge. These are off for these paths
     * only; every PolicyOS file keeps the full strictness above.
     *
     * Remove a glob from this list when that file is cleaned up or dropped.
     */
    files: [
      "src/app/(osiris)/**/*.{ts,tsx}",
      "src/components/osiris/**/*.{ts,tsx}",
      "src/lib/osiris/**/*.{ts,tsx}",
      "src/workers/**/*.ts",
      "src/app/api/cctv/**/*.ts",
      "src/app/api/maritime/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/exhaustive-deps": "off",
    },
    linterOptions: {
      // Upstream carries inline eslint-disable comments for the rules turned
      // off above. They are correct against upstream's config, so they are not
      // reported as unused here rather than being stripped out of vendored files.
      reportUnusedDisableDirectives: "off",
    },
  },
]);

export default eslintConfig;
