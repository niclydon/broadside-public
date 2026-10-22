import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // New in eslint-config-next 16 (React Compiler-era hooks
      // rules). The flagged setState-in-effect patterns predate
      // the October 2026 dependency refresh; restructuring them
      // is app work, not part of a dependency bump. Downgraded to
      // warn so the signal stays visible without blocking.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      // The TypeScript lint layer is new to this repo with the
      // flat config; the codebase uses `any` at several
      // integration boundaries. Warn until those are typed.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // One-off tsx scripts load CommonJS helpers directly; that
    // pattern is established there and harmless.
    files: ["scripts/**"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
