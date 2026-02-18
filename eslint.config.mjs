import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "workers/**/node_modules/**", "workers/**/.wrangler/**", "docs/.vitepress/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["workers/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
