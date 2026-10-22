// Lint guards React hook correctness; formatting stays with Prettier and types with tsc.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist*/**", "playwright-report/**", "test-results/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts", "*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Language checks that TypeScript does not cover; type-aware rules stay with tsc.
      "no-debugger": js.configs.recommended.rules["no-debugger"],
      "no-dupe-keys": js.configs.recommended.rules["no-dupe-keys"],
      "no-duplicate-case": js.configs.recommended.rules["no-duplicate-case"],
      "no-self-assign": js.configs.recommended.rules["no-self-assign"],
      "no-unsafe-finally": js.configs.recommended.rules["no-unsafe-finally"],
    },
  },
];
