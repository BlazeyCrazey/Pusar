import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const NODE_MODULES = ["electron", "node:*", "fs", "fs/*", "path", "os", "child_process", "crypto", "url"];

export default defineConfig(
  {
    ignores: [
      "out/**",
      "release/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      // The M0 test panel is plain JS and goes away as real screens replace it.
      "src/renderer/spike/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  // Architecture boundaries. These are errors so the layers can't quietly merge.
  {
    files: ["src/renderer/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...NODE_MODULES, "**/main/**", "**/core/**", "**/preload/**"],
              message: "The UI reaches the system only through window.pusar (see shared/ipc.ts).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["electron", "**/main/**", "**/preload/**", "**/renderer/**"],
              message: "core is plain Node logic, so it stays unit-testable without Electron.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...NODE_MODULES, "**/main/**", "**/core/**", "**/preload/**", "**/renderer/**"],
              message: "shared is used by both processes, so it can't depend on either.",
            },
          ],
        },
      ],
    },
  },
);
