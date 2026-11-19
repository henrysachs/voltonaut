import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/shared/vitest.config.ts",
      "packages/engine/vitest.config.ts",
      "packages/rules/vitest.config.ts",
      "packages/ble/vitest.config.ts",
      "apps/web/vitest.config.ts",
      "apps/server/vitest.config.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "packages/shared/src/**/*.ts",
        "packages/engine/src/**/*.ts",
        "packages/rules/src/**/*.ts",
        "packages/ble/src/**/*.ts",
        "apps/web/src/**/*.ts",
        "apps/server/src/**/*.ts",
      ],
      exclude: ["**/*.test.ts"],
      thresholds: {
        "packages/engine/src/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 85,
        },
        "packages/rules/src/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 85,
        },
        "packages/shared/src/**": {
          lines: 85,
          statements: 85,
          functions: 85,
          branches: 80,
        },
        "packages/ble/src/**": {
          lines: 85,
          statements: 85,
          functions: 85,
          branches: 80,
        },
        "apps/server/src/**": {
          lines: 75,
          statements: 75,
          functions: 75,
          branches: 70,
        },
        "apps/web/src/**": {
          lines: 60,
          statements: 60,
          functions: 60,
          branches: 60,
        },
      },
    },
  },
});
