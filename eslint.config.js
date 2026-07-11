// Configuración flat de ESLint, coherente con Prettier (prettier desactiva
// reglas de formato para evitar conflictos). Identificadores en inglés.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Carpetas que ESLint nunca debe analizar.
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // No permitir console.log de debug; sí console.error/warn para logging.
      "no-console": ["error", { allow: ["error", "warn"] }],
      // Forzar el uso de imports de tipo explícitos (encaja con verbatimModuleSyntax).
      "@typescript-eslint/consistent-type-imports": "error",
      // Variables sin usar son error salvo que empiecen con "_".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Los archivos de test pueden usar console libremente.
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // El frontend vanilla corre en el navegador: declarar sus globals para
    // que ESLint no marque falsos no-undef (document, fetch, window, etc.).
    files: ["web/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        document: "readonly",
        window: "readonly",
        fetch: "readonly",
        console: "readonly",
        URL: "readonly",
        navigator: "readonly",
        prompt: "readonly",
        confirm: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  // Debe ir último: desactiva reglas de formato que maneja Prettier.
  prettier,
);
