import { defineConfig } from "@playwright/test";

const isContinuousIntegration = process.env["CI"] === "1" || process.env["CI"] === "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !isContinuousIntegration,
    timeout: 30_000,
  },
});
