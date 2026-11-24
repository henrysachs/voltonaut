import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateAssets } from "./assets.ts";

const rootDirectory = resolve(import.meta.dirname, "..");

interface FixturePaths {
  readonly directory: string;
  readonly assetsDirectory: string;
}

interface RecordOverrides {
  readonly file?: string;
  readonly byteSize?: number;
  readonly triangles?: number;
  readonly triangleBudget?: number;
}

function fixtureGlbJson(): string {
  return JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    buffers: [{ byteLength: 36 }],
  });
}

function fixturePositions(): Buffer {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const binary = Buffer.alloc(36);

  positions.forEach((value, index) => {
    binary.writeFloatLE(value, index * 4);
  });

  return binary;
}

function glbBytes(): Buffer {
  const binary = fixturePositions();
  const json = Buffer.from(fixtureGlbJson());
  const jsonPadding = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
  const binaryPadding = Buffer.alloc((4 - (binary.length % 4)) % 4);
  const jsonChunk = Buffer.alloc(8);
  const binaryChunk = Buffer.alloc(8);
  jsonChunk.writeUInt32LE(json.length + jsonPadding.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  binaryChunk.writeUInt32LE(binary.length + binaryPadding.length, 0);
  binaryChunk.writeUInt32LE(0x004e4942, 4);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);

  const chunks = [jsonChunk, json, jsonPadding, binaryChunk, binary, binaryPadding];
  let totalLength = header.length;

  for (const chunk of chunks) {
    totalLength += chunk.length;
  }

  header.writeUInt32LE(totalLength, 8);

  return Buffer.concat([header, ...chunks]);
}

function fixtureRecord(overrides: RecordOverrides = {}) {
  return {
    id: "bike",
    file: "bike.glb",
    license: "CC0-1.0",
    triangles: 1,
    triangleBudget: 25000,
    materials: ["material"],
    nodeNames: ["model"],
    byteSize: glbBytes().length,
    ...overrides,
  };
}

function writeLicenses(assetsDirectory: string, files: readonly string[]): void {
  const rows = files.map(
    (file) => `| \`${file}\` | Original test model | CC0-1.0 | https://example.com/license |`,
  );

  writeFileSync(
    join(assetsDirectory, "LICENSES.md"),
    "# Asset licenses\n\n| File | Source | License | License URL |\n" +
      "| --- | --- | --- | --- |\n" +
      `${rows.join("\n")}\n`,
  );
}

function withFixture(run: (paths: Readonly<FixturePaths>) => void): void {
  const directory = mkdtempSync(join(rootDirectory, "assets-src", ".assets-test-"));
  const assetsDirectory = join(directory, "apps", "web", "public", "assets");
  const bytes = glbBytes();
  mkdirSync(assetsDirectory, { recursive: true });
  mkdirSync(join(directory, "assets-src"), { recursive: true });
  writeFileSync(join(assetsDirectory, "bike.glb"), bytes);
  writeLicenses(assetsDirectory, ["bike.glb"]);
  writeFileSync(
    join(directory, "assets-src", "manifest.json"),
    JSON.stringify({ schemaVersion: 1, assets: [fixtureRecord({ byteSize: bytes.length })] }),
  );

  try {
    run({ directory, assetsDirectory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await test("validates the generated starter pack and derives GLB triangles", () => {
  const report = validateAssets(rootDirectory);
  assert.equal(report.assetCount, 3);
  assert.equal(report.glbCount, 3);
  assert.equal(report.totalTriangles, 5802);
});

await test("requires a recursive license entry", () => {
  withFixture(({ assetsDirectory, directory }) => {
    writeFileSync(join(assetsDirectory, "LICENSES.md"), "# Asset licenses\n");
    assert.throws(() => validateAssets(directory), /without license entry/u);
  });
});

await test("rejects a manifest path outside the asset directory", () => {
  withFixture(({ directory }) => {
    writeFileSync(
      join(directory, "assets-src", "manifest.json"),
      JSON.stringify({ schemaVersion: 1, assets: [fixtureRecord({ file: "../bike.glb" })] }),
    );
    assert.throws(() => validateAssets(directory), /relative GLB path/u);
  });
});

await test("rejects a stale manifest byte size", () => {
  withFixture(({ directory }) => {
    writeFileSync(
      join(directory, "assets-src", "manifest.json"),
      JSON.stringify({ schemaVersion: 1, assets: [fixtureRecord({ byteSize: 13 })] }),
    );
    assert.throws(() => validateAssets(directory), /does not match actual/u);
  });
});

await test("rejects a raised manifest triangle budget", () => {
  withFixture(({ directory }) => {
    writeFileSync(
      join(directory, "assets-src", "manifest.json"),
      JSON.stringify({ schemaVersion: 1, assets: [fixtureRecord({ triangleBudget: 25001 })] }),
    );
    assert.throws(() => validateAssets(directory), /canonical triangle budget/u);
  });
});

await test("rejects a malformed manifest field type", () => {
  withFixture(({ directory }) => {
    writeFileSync(
      join(directory, "assets-src", "manifest.json"),
      JSON.stringify({ schemaVersion: 1, assets: [{ ...fixtureRecord(), id: 7 }] }),
    );
    assert.throws(() => validateAssets(directory), /expected a non-empty string/u);
  });
});

await test("rejects a malformed manifest with missing fields", () => {
  withFixture(({ directory }) => {
    writeFileSync(
      join(directory, "assets-src", "manifest.json"),
      JSON.stringify({ schemaVersion: 1, assets: [{ id: "bike" }] }),
    );
    assert.throws(() => validateAssets(directory), /expected exactly/u);
  });
});

await test("rejects manifest triangle counts that differ from GLB data", () => {
  withFixture(({ directory }) => {
    writeFileSync(
      join(directory, "assets-src", "manifest.json"),
      JSON.stringify({ schemaVersion: 1, assets: [fixtureRecord({ triangles: 2 })] }),
    );
    assert.throws(() => validateAssets(directory), /do not match GLB 1/u);
  });
});

await test("rejects a GLB missing from the manifest", () => {
  withFixture(({ assetsDirectory, directory }) => {
    writeFileSync(join(assetsDirectory, "pine_tree.glb"), glbBytes());
    writeLicenses(assetsDirectory, ["bike.glb", "pine_tree.glb"]);
    assert.throws(() => validateAssets(directory), /must list every GLB exactly once/u);
  });
});
