import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function withTempDir(run: (root: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-guard-"));

  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
