import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

/** @type {readonly (readonly [string, string, string])[]} */
const captures = [
  [
    "zwift-hub-one",
    "ble-1-zwift-hub-2026-11-27T07-44-18.002Z.json",
    "d7270d86a72a8dff20250e7ac988c041638960b62038f320cde0b9bbcf2a3418",
  ],
  [
    "zwift-click-v2-right",
    "ble-2-zwift-click-2026-11-27T07-47-32.089Z.json",
    "65c8edd39679c6523401b75f9cc4200492b5ba04307909c966fa074b5fb86bb2",
  ],
];

const directory = process.argv[2];

if (directory === undefined) {
  throw new Error("Usage: node scripts/import-hub-click-captures.mjs <original-capture-directory>");
}

await Promise.all(
  captures.map(async ([device, name, expectedSha256]) => {
    const original = await readFile(`${directory}/${name}`);
    const sha256 = createHash("sha256").update(original).digest("hex");

    if (sha256 !== expectedSha256) {
      throw new Error(`Unexpected source SHA-256 for ${device}`);
    }

    const capture = original
      .toString("utf8")
      .replace(/"deviceId":\s*"(?:[^"\\]|\\.)*"/u, `"deviceId": "hardware-${device}-20261127"`)
      .replace(/"ua":\s*"(?:[^"\\]|\\.)*"/u, '"ua": "anonymized hardware capture browser"');

    const destination = new URL(
      `../fixtures/ble/${device}-hardware-20261127.json`,
      import.meta.url,
    );

    await writeFile(destination, capture.endsWith("\n") ? capture : `${capture}\n`, { flag: "wx" });
  }),
);
