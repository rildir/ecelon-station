// Minimal lint: catch undefined variables and unused imports; style is left to the editor.
import js from "@eslint/js";
import globals from "globals";

// control characters and escaped brackets in regexes are deliberate (ANSI codes, Windows file names)
const RULES = { "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }], "no-empty": ["error", { allowEmptyCatch: true }], "no-control-regex": "off", "no-useless-escape": "off" };

export default [
  js.configs.recommended,
  { ignores: ["node_modules/", "public/vendor/", "data/", "logs/", "demo/"] },
  { files: ["server/**/*.js", "bin/**/*.js", "scripts/**/*.mjs", "tests/**/*.mjs"], languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: globals.node },
    rules: RULES },
  { files: ["public/**/*.js"], languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.browser, monaco: "readonly", require: "readonly" } },
    rules: RULES },
];
