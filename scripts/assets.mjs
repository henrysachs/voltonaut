#!/usr/bin/env node
import { validateAssets } from "./assets.ts";

try {
  const report = validateAssets();
  process.stdout.write(
    `assets: ${report.assetCount} files, ${report.glbCount} GLBs, ${report.totalBytes} bytes, ` +
      `${report.totalTriangles} triangles, licenses and manifest valid\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`assets check failed: ${message}`);
  process.exit(1);
}
