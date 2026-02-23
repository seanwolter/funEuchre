module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  ignorePatterns: [
    "**/dist/**",
    "**/node_modules/**",
    "pnpm-lock.yaml",
    "package-lock.json"
  ],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  rules: {
    "eqeqeq": [
      "error",
      "always"
    ],
    "no-var": "error",
    "prefer-const": "error",
    "object-shorthand": "error",
    "no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }
    ],
    "no-shadow": "error",
    "no-implicit-coercion": "error"
  }
};
