import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

export default ts.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/.wrangler/",
      "**/worker-configuration.d.ts",
      "docs/archive/",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    // Throwaway spike: keep it linted for obvious bugs, not style.
    files: ["spikes/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
