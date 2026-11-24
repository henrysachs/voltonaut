import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildProduction } from "./pwaTestKit.js";

const PUBLIC = resolve(import.meta.dirname, "../../public");

async function copyPublic(): Promise<string> {
  const target = join(await mkdtemp(join(tmpdir(), "voltonaut-public-")), "public");
  await cp(PUBLIC, target, { recursive: true });

  return target;
}

async function workerOf(publicDir: string): Promise<string> {
  return readFile(join(await buildProduction(publicDir), "sw.js"), "utf8");
}

describe("service worker release version", () => {
  it("changes when only a public cached file changes", async () => {
    const original = await copyPublic();
    const identical = await copyPublic();
    const changedIcon = await copyPublic();
    await writeFile(
      join(changedIcon, "icons/icon.svg"),
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
    );

    const base = await workerOf(original);

    expect(await workerOf(identical)).toBe(base);
    expect(await workerOf(changedIcon)).not.toBe(base);
  }, 60_000);

  it("changes when the manifest changes", async () => {
    const original = await copyPublic();
    const changed = await copyPublic();
    const manifest = join(changed, "manifest.webmanifest");
    await writeFile(manifest, `${await readFile(manifest, "utf8")}\n`);

    expect(await workerOf(changed)).not.toBe(await workerOf(original));
  }, 60_000);
});
