/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  extends: ["eslint:recommended", "prettier"],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      extends: ["plugin:@typescript-eslint/recommended"],
      rules: {
        "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        "@typescript-eslint/no-explicit-any": "warn",
        "no-console": ["warn", { allow: ["warn", "error"] }],
      },
    },
  ],
  ignorePatterns: ["node_modules", "dist", ".next", "coverage", "*.generated.*", "drizzle"],
  env: { node: true, es2022: true },
};
