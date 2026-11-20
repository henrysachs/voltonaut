#!/usr/bin/env node
// Regenerates fixtures/rides/*.golden.json from the current engine
// (docs/10-testing.md section 3: baseline updates only via golden:update
// plus the baseline-update PR label).
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["exec", "vitest", "run", "apps/web/src/golden"], {
  env: { ...process.env, GOLDEN_UPDATE: "1" },
  stdio: "inherit",
});

if (result.error !== undefined) {
  console.error(`golden:update could not start vitest: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
