import {
  optionalField,
  parseJson,
  requireArray,
  requireExactKeys,
  requireField,
  requireInteger,
  requireObject,
  requireText,
} from "./assets-json.ts";
import type { JsonNode } from "./assets-json.ts";

export type AssetId = "bike" | "pine_tree" | "rock_cluster";

export interface AssetRecord {
  readonly id: AssetId;
  readonly file: string;
  readonly license: string;
  readonly triangles: number;
  readonly triangleBudget: number;
  readonly materials: readonly string[];
  readonly nodeNames: readonly string[];
  readonly byteSize: number;
}

export interface AssetManifest {
  readonly schemaVersion: 1;
  readonly assets: readonly AssetRecord[];
}

interface GlbBytes {
  readonly length: number;
  readonly readUInt32LE: (offset: number) => number;
  readonly subarray: (start: number, end: number) => Buffer;
}

const RECORD_KEYS: readonly string[] = [
  "id",
  "file",
  "license",
  "triangles",
  "triangleBudget",
  "materials",
  "nodeNames",
  "byteSize",
];

function parseAssetId(value: JsonNode, label: string): AssetId {
  const id = requireText(value, label);

  if (id === "bike" || id === "pine_tree" || id === "rock_cluster") return id;

  throw new Error(`${label}: unsupported asset id ${id}`);
}

export function canonicalBudget(id: AssetId): number {
  if (id === "bike") return 25_000;

  if (id === "pine_tree") return 2_000;

  return 1_000;
}

function parseNames(value: JsonNode, label: string): readonly string[] {
  const items = requireArray(value, label);
  const names = items.map((item, index) => requireText(item, `${label}[${index}]`));

  if (new Set(names).size !== names.length) {
    throw new Error(`${label}: duplicate names`);
  }

  return names;
}

function parseRecord(value: JsonNode, index: number): AssetRecord {
  const label = `manifest asset ${index + 1}`;
  const fields = requireObject(value, label);
  requireExactKeys(fields, RECORD_KEYS, label);

  return {
    id: parseAssetId(requireField(fields, "id", label), `${label}.id`),
    file: requireText(requireField(fields, "file", label), `${label}.file`),
    license: requireText(requireField(fields, "license", label), `${label}.license`),
    triangles: requireInteger(requireField(fields, "triangles", label), `${label}.triangles`, 1),
    triangleBudget: requireInteger(
      requireField(fields, "triangleBudget", label),
      `${label}.triangleBudget`,
      1,
    ),
    materials: parseNames(requireField(fields, "materials", label), `${label}.materials`),
    nodeNames: parseNames(requireField(fields, "nodeNames", label), `${label}.nodeNames`),
    byteSize: requireInteger(requireField(fields, "byteSize", label), `${label}.byteSize`, 1),
  };
}

export function parseManifest(text: string): AssetManifest {
  const fields = requireObject(parseJson(text), "manifest");
  requireExactKeys(fields, ["schemaVersion", "assets"], "manifest");

  const schemaVersion = requireInteger(
    requireField(fields, "schemaVersion", "manifest"),
    "schemaVersion",
    1,
  );

  if (schemaVersion !== 1) throw new Error("manifest.schemaVersion must be 1");

  const values = requireArray(requireField(fields, "assets", "manifest"), "manifest.assets");

  if (values.length === 0) throw new Error("manifest.assets must not be empty");

  return { schemaVersion: 1, assets: values.map((value, index) => parseRecord(value, index)) };
}

function readGlbJson(bytes: GlbBytes, label: string): JsonNode {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error(`${label}: invalid GLB header`);
  }

  if (bytes.readUInt32LE(4) !== 2) throw new Error(`${label}: GLB version must be 2`);

  if (bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`${label}: GLB header length does not match file size`);
  }

  const jsonLength = bytes.readUInt32LE(12);
  const jsonEnd = 20 + jsonLength;

  if (jsonLength === 0 || jsonEnd > bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error(`${label}: missing GLB JSON chunk`);
  }

  return parseJson(bytes.subarray(20, jsonEnd).toString("utf8"));
}

function readAccessorCount(
  accessors: readonly JsonNode[],
  indexValue: JsonNode,
  label: string,
): number {
  const index = requireInteger(indexValue, `${label} accessor index`, 0);
  const accessor = accessors[index];

  if (accessor === undefined) throw new Error(`${label}: accessor ${index} is missing`);

  const fields = requireObject(accessor, `${label} accessor ${index}`);

  return requireInteger(requireField(fields, "count", label), `${label} accessor count`, 0);
}

function readPrimitiveTriangles(
  value: JsonNode,
  accessors: readonly JsonNode[],
  label: string,
): number {
  const fields = requireObject(value, label);
  const modeValue = optionalField(fields, "mode");
  const mode = modeValue === undefined ? 4 : requireInteger(modeValue, `${label}.mode`, 0);

  if (mode !== 4) throw new Error(`${label}: only triangle primitives are supported`);

  const attributes = requireObject(
    requireField(fields, "attributes", label),
    `${label}.attributes`,
  );

  const positionCount = readAccessorCount(
    accessors,
    requireField(attributes, "POSITION", label),
    `${label} POSITION`,
  );

  const indices = optionalField(fields, "indices");

  const count =
    indices === undefined
      ? positionCount
      : readAccessorCount(accessors, indices, `${label} indices`);

  if (count % 3 !== 0)
    throw new Error(`${label}: triangle vertex count ${count} is not divisible by 3`);

  return count / 3;
}

export function deriveTriangleCount(bytes: GlbBytes, label: string): number {
  const root = requireObject(readGlbJson(bytes, label), label);
  const accessors = requireArray(requireField(root, "accessors", label), `${label}.accessors`);
  const meshes = requireArray(requireField(root, "meshes", label), `${label}.meshes`);

  if (meshes.length === 0) throw new Error(`${label}: no meshes`);

  let triangles = 0;

  for (const [meshIndex, mesh] of meshes.entries()) {
    const meshLabel = `${label} mesh ${meshIndex}`;
    const fields = requireObject(mesh, meshLabel);

    const primitives = requireArray(
      requireField(fields, "primitives", meshLabel),
      `${meshLabel}.primitives`,
    );

    if (primitives.length === 0) throw new Error(`${meshLabel}: no primitives`);

    for (const [primitiveIndex, primitive] of primitives.entries()) {
      triangles += readPrimitiveTriangles(
        primitive,
        accessors,
        `${meshLabel} primitive ${primitiveIndex}`,
      );
    }
  }

  return triangles;
}
