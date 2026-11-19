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

  const entries = readdirSync(assetsDir, { withFileTypes: true });
  const assets = entries.filter((entry) => entry.isFile() && entry.name !== "LICENSES.md");

  for (const asset of assets) {
    if (!licenses.includes(asset.name)) {
      throw new Error(`asset without license entry: ${asset.name}`);
    }
  }

  console.log(`assets: ${assets.length} assets, license register present`);
} catch (error) {
  console.error(`assets check failed: ${error.message}`);
  process.exit(1);
}
