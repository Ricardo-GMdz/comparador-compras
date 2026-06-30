import { defineConfig } from "vitest/config";

// Configuración de Vitest: entorno Node, busca tests junto al código fuente.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Solo medimos cobertura del código fuente, no de configs ni del bin.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.{test,spec}.ts", "src/index.ts"],
    },
  },
});
