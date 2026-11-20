import { readdirSync } from "node:fs";
import { join } from "node:path";

const ignoredDirectories = new Set([
  ".git",
  ".audit",
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  ".stryker-tmp",
]);

export function collectFiles(root: string, directory: string = root): readonly string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }

      if (entryPath === join(root, "tools", "oxlint", "anti-slop")) {
        continue;
      }

      files.push(...collectFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

export function relative(root: string, file: string): string {
  return file.slice(root.length + 1);
}
