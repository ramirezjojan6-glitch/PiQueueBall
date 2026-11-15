const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "android/**",
      "www/**",
      "node_modules/**",
      "package-lock.json"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        process: "readonly",
        console: "readonly"
      }
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none"
      }]
    }
  }
];
