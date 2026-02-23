module.exports = [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "pnpm-lock.yaml",
      "package-lock.json"
    ]
  },
  {
    files: [
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      eqeqeq: [
        "error",
        "always"
      ],
      "no-var": "error",
      "prefer-const": "error",
      "object-shorthand": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "no-shadow": "error",
      "no-implicit-coercion": "error"
    }
  }
];
