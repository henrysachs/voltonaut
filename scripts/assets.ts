import { readdirSync, readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { canonicalBudget, deriveTriangleCount, parseManifest } from "./assets-contract.ts";
import type { AssetManifest, AssetRecord } from "./assets-contract.ts";

const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

interface LicenseRow {
  readonly source: string;
  readonly license: string;
  readonly url: string;
}

interface LicenseRegister {
  readonly has: (file: string) => boolean;
  readonly get: (file: string) => LicenseRow | undefined;
}

interface AssetReport {
  readonly assetCount: number;
  readonly glbCount: number;
  readonly totalBytes: number;
  readonly totalTriangles: number;
}

interface RecordReport {
  readonly file: string;
  readonly triangles: number;
}

function compareNames(left: string, right: string): number {
  if (left < right) return -1;

  if (left > right) return 1;

  return 0;
}

function compareEntries(left: Readonly<Dirent>, right: Readonly<Dirent>): number {
  return compareNames(left.name, right.name);
}

function listFiles(directory: string, prefix = ""): string[] {
  const files: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true }).toSorted(compareEntries);

  for (const entry of entries) {
    const assetPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...listFiles(join(directory, entry.name), assetPath));
    } else if (entry.isFile()) {
      files.push(assetPath);
    }
  }

  return files;
}

function readLicenseRows(licenses: string): Map<string, LicenseRow> {
  const rows = new Map<string, LicenseRow>();

  for (const line of licenses.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());

    if (cells.length < 6) continue;

    const fileCell = cells[1];
    const source = cells[2];
    const license = cells[3];
    const url = cells[4];

    if (
      fileCell === undefined ||
      source === undefined ||
      license === undefined ||
      url === undefined
    ) {
      continue;
    }

    const file = fileCell.replace(/^`(.*)`$/u, "$1");

    if (!file || file === "File" || /^:?-+:?$/u.test(file)) continue;

    if (rows.has(file)) throw new Error(`duplicate license entry: ${file}`);

    if (!source || !license || !url) throw new Error(`incomplete license entry: ${file}`);

    rows.set(file, { source, license, url });
  }

  return rows;
}

function readManifest(path: string): AssetManifest {
  return parseManifest(readFileSync(path, "utf8"));
}

function validateLicenseCoverage(assetFiles: readonly string[], rows: LicenseRegister): void {
  for (const assetFile of assetFiles) {
    if (!rows.has(assetFile)) throw new Error(`asset without license entry: ${assetFile}`);
  }
}

function validateUniqueIds(records: readonly AssetRecord[]): void {
  const ids = new Set<string>();

  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`duplicate manifest id: ${record.id}`);
    ids.add(record.id);
  }
}

function recordAssetPath(
  record: AssetRecord,
  index: number,
  assetsDir: string,
  glbFiles: readonly string[],
): string {
  const label = `manifest asset ${index + 1}`;

  if (
    isAbsolute(record.file) ||
    record.file.includes("\\") ||
    record.file.split("/").includes("..") ||
    !record.file.endsWith(".glb")
  ) {
    throw new Error(`${label}: file must be a relative GLB path`);
  }

  if (record.file !== `${record.id}.glb`) {
    throw new Error(`${label}: file must match the canonical asset id`);
  }

  if (!glbFiles.includes(record.file)) throw new Error(`manifest GLB is missing: ${record.file}`);

  return resolve(assetsDir, record.file);
}

function validateRecordLicense(record: AssetRecord, rows: LicenseRegister): void {
  const row = rows.get(record.file);

  if (row === undefined) throw new Error(`manifest asset without license entry: ${record.file}`);

  if (row.license !== record.license) {
    throw new Error(`manifest license does not match LICENSES.md: ${record.file}`);
  }
}

function readRecordTriangles(record: AssetRecord, assetPath: string): number {
  const budget = canonicalBudget(record.id);

  if (record.triangleBudget !== budget) {
    throw new Error(
      `${record.file}: canonical triangle budget is ${budget}, manifest declares ${record.triangleBudget}`,
    );
  }

  const actualByteSize = statSync(assetPath).size;

  if (actualByteSize !== record.byteSize) {
    throw new Error(
      `${record.file}: byteSize ${record.byteSize} does not match actual ${actualByteSize}`,
    );
  }

  const triangles = deriveTriangleCount(readFileSync(assetPath), record.file);

  if (record.triangles !== triangles) {
    throw new Error(
      `${record.file}: manifest triangles ${record.triangles} do not match GLB ${triangles}`,
    );
  }

  if (triangles > budget) {
    throw new Error(`${record.file}: ${triangles} triangles exceeds canonical budget ${budget}`);
  }

  return triangles;
}

function validateRecord(
  record: AssetRecord,
  index: number,
  assetsDir: string,
  rows: LicenseRegister,
  glbFiles: readonly string[],
): RecordReport {
  const assetPath = recordAssetPath(record, index, assetsDir, glbFiles);
  validateRecordLicense(record, rows);

  return { file: record.file, triangles: readRecordTriangles(record, assetPath) };
}

function validateManifestCoverage(files: readonly string[], glbFiles: readonly string[]): void {
  const sortedFiles = files.toSorted(compareNames);

  if (
    sortedFiles.length !== glbFiles.length ||
    sortedFiles.some((file, index) => file !== glbFiles[index])
  ) {
    throw new Error("manifest must list every GLB exactly once");
  }
}

function validateTotalSize(assetFiles: readonly string[], assetsDir: string): number {
  let totalBytes = 0;

  for (const assetFile of assetFiles) {
    totalBytes += statSync(resolve(assetsDir, assetFile)).size;
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`asset total ${totalBytes} bytes exceeds ${MAX_TOTAL_BYTES} bytes`);
  }

  return totalBytes;
}

export function validateAssets(rootDirectory = process.cwd()): AssetReport {
  const assetsDir = join(rootDirectory, "apps", "web", "public", "assets");
  const licensesPath = join(assetsDir, "LICENSES.md");
  const manifestPath = join(rootDirectory, "assets-src", "manifest.json");
  const licenses = readFileSync(licensesPath, "utf8");

  if (!licenses.startsWith("# Asset licenses")) {
    throw new Error("LICENSES.md must start with '# Asset licenses'");
  }

  const rows = readLicenseRows(licenses);
  const assetFiles = listFiles(assetsDir).filter((file) => file !== "LICENSES.md");
  validateLicenseCoverage(assetFiles, rows);

  const manifest = readManifest(manifestPath);
  const glbFiles = assetFiles.filter((file) => file.endsWith(".glb")).toSorted(compareNames);
  validateUniqueIds(manifest.assets);

  const reports = manifest.assets.map((record, index) =>
    validateRecord(record, index, assetsDir, rows, glbFiles),
  );

  const files = reports.map((report) => report.file);
  const duplicateFile = files.find((file, index) => files.indexOf(file) !== index);

  if (duplicateFile !== undefined) throw new Error(`duplicate manifest file: ${duplicateFile}`);

  validateManifestCoverage(files, glbFiles);
  const totalBytes = validateTotalSize(assetFiles, assetsDir);
  let totalTriangles = 0;

  for (const report of reports) {
    totalTriangles += report.triangles;
  }

  return { assetCount: assetFiles.length, glbCount: glbFiles.length, totalBytes, totalTriangles };
}
