#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const assetsDir = join("apps", "web", "public", "assets");
const licensesFile = join(assetsDir, "LICENSES.md");

try {
  const licenses = readFileSync(licensesFile, "utf8");

  if (!licenses.includes("# Asset licenses")) {
    throw new Error("LICENSES.md must start with '# Asset licenses'");
  }

  const assetNames = [];

  for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== "LICENSES.md") {
      assetNames.push(entry.name);
    }
  }

  for (const assetName of assetNames) {
    if (!licenses.includes(assetName)) {
      throw new Error(`asset without license entry: ${assetName}`);
    }
  }

  process.stdout.write(`assets: ${assetNames.length} assets, license register present\n`);
} catch (error) {
  console.error(`assets check failed: ${error.message}`);
  process.exit(1);
}
