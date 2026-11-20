import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ENGINE_SRC = fileURLToPath(new URL("../../../../packages/engine/src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(entryPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

describe("engine purity (AK1: no wall clocks, no randomness)", () => {
  it("contains no Date.now, performance.now or Math.random in production code", () => {
    const offenders = sourceFiles(ENGINE_SRC).filter((file) =>
      /(?:Date\.now|performance\.now|Math\.random)\(/u.test(readFileSync(file, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
