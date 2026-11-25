import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "..",
  test: {
    name: "web-performance",
    environment: "node",
    include: ["src/sync/progressOutboxDatabase.performance.test.ts"],
    maxWorkers: 1,
    sequence: { groupOrder: 1 },
  },
});
