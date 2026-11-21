import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { captureSimArchive } from "./ride-delivery-verification/browser.mjs";
import { describeArchive, requireRecordingV2 } from "./ride-delivery-verification/archive.mjs";
import { buildWeb, serveBuild, sha256 } from "./ride-delivery-verification/artifact.mjs";

const root = resolve(import.meta.dirname, "..");
const temporary = join(tmpdir(), "opencode");

await mkdir(temporary, { recursive: true });

const artifacts = await mkdtemp(join(temporary, "delivery-capture-harness-"));
const output = join(artifacts, "built-web");
const rerun = "mise exec -- node scripts/verify-ride-delivery.mjs";

process.stdout.write(`Artifacts: ${artifacts}\nRerun: ${rerun}\n`);

let host;

try {
  const workers = await buildWeb({ root, artifacts, output, rerun });
  host = await serveBuild(output, artifacts);
  const archive = await captureSimArchive({ origin: host.origin, artifacts, workers });

  await writeFile(
    join(artifacts, "actual-sanitized-archive-shape.json"),
    `${JSON.stringify({ archiveSha256: sha256(archive), ...describeArchive(archive) }, null, 2)}\n`,
  );
  requireRecordingV2(archive);
  await writeFile(
    join(artifacts, "result.log"),
    "PASS: built application stored a plausible RecordingV2 journal.\n",
  );
  process.stdout.write("PASS: built application stored a plausible RecordingV2 journal.\n");
} catch (error) {
  const detail = error instanceof Error ? error.stack : String(error);
  await writeFile(join(artifacts, "result.log"), `${detail}\n`);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
} finally {
  await host?.close();
}
