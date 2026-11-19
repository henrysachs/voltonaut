#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "pnpm",
  ["exec", "depcruise", "fixtures/depcruise", "--config", ".dependency-cruiser.cjs"],
  { encoding: "utf8" },
);

if (result.error !== undefined) {
  console.error(`depcruise negative test could not start: ${result.error.message}`);
  process.exit(1);
}

if (result.status === 0) {
  console.error("depcruise negative test failed: forbidden cross-app fixture passed");
  process.exit(1);
}

console.log("depcruise negative test passed: forbidden cross-app fixture was rejected");
