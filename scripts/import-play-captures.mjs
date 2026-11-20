import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

/** @type {readonly (readonly [string, string, string])[]} */
const captures = [
  [
    "right",
    "ble-2026-11-20T16-54-57.901Z.json",
    "7b54166efab49a02af8b937197b95fe454a224af317bf84f6ff8bd77520f8adc",
  ],
  [
    "left",
    "ble-2026-11-20T17-05-04.565Z.json",
    "a2f68e9c0cafb2936ee7110eb3cbe6ba2ccc1d3dd30d11a53e4d196e66df4253",
  ],
];

const directory = process.argv[2];

if (directory === undefined) {
  throw new Error("Usage: node scripts/import-play-captures.mjs <original-capture-directory>");
}

await Promise.all(
  captures.map(async ([side, name, expectedSha256]) => {
    const original = await readFile(`${directory}/${name}`);
    const sha256 = createHash("sha256").update(original).digest("hex");

    if (sha256 !== expectedSha256) {
      throw new Error(`Unexpected source SHA-256 for ${side}`);
    }

    const capture = original
      .toString("utf8")
      .replace(/"deviceId":\s*"(?:[^"\\]|\\.)*"/u, `"deviceId": "hardware-play-${side}-20261120"`)
      .replace(/"ua":\s*"(?:[^"\\]|\\.)*"/u, '"ua": "anonymized hardware capture browser"');

    const destination = new URL(
      `../fixtures/ble/zwift-play-${side}-hardware-20261120.json`,
      import.meta.url,
    );

    await writeFile(destination, `${capture}\n`, { flag: "wx" });
  }),
);
