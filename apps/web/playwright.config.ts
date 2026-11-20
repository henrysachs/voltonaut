import { defineConfig } from "@playwright/test";

function parseTestPort(value: string | undefined): number {
  const text = value ?? "5173";
  const port = Number(text);

  if (/^[1-9]\d{3,4}$/u.test(text) && port >= 1024 && port <= 65535) return port;

  throw new Error("E2E_PORT must be an integer between 1024 and 65535");
}

const isContinuousIntegration = process.env["CI"] === "1" || process.env["CI"] === "true";
const port = parseTestPort(process.env["E2E_PORT"]);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  workers: isContinuousIntegration ? 1 : "50%",
  use: {
    baseURL: origin,
    trace: "on-first-retry",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: !isContinuousIntegration,
    timeout: 30_000,
  },
});
