type JsonInput =
  | string
  | number
  | boolean
  | null
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput };

export type JsonValue =
  | readonly ["text", string]
  | readonly ["number", number]
  | readonly ["boolean", boolean]
  | readonly ["null"]
  | readonly ["array", readonly JsonNode[]]
  | readonly ["object", ReadonlyMap<string, JsonNode>];

export interface JsonNode {
  readonly read: () => JsonValue;
}

export interface JsonFields {
  readonly size: number;
  readonly has: (key: string) => boolean;
  readonly get: (key: string) => JsonNode | undefined;
}

function isJsonInput(value: unknown): value is JsonInput {
  if (value === null) return true;

  if (Array.isArray(value)) return value.every((item) => isJsonInput(item));

  if (value instanceof Object) return Object.values(value).every((item) => isJsonInput(item));

  const serialized = JSON.stringify(value);

  if (serialized === undefined) return false;

  const roundTrip: unknown = JSON.parse(serialized);

  return roundTrip === value;
}

function isJsonText(value: JsonInput): value is string {
  const serialized = JSON.stringify(value);

  return serialized !== undefined && serialized.startsWith('"') && JSON.parse(serialized) === value;
}

function isJsonArray(value: JsonInput): value is readonly JsonInput[] {
  return Array.isArray(value);
}

function isJsonObject(value: JsonInput): value is { readonly [key: string]: JsonInput } {
  return value instanceof Object && !Array.isArray(value);
}

function toJsonNode(value: JsonInput): JsonNode {
  if (value === null) return { read: () => ["null"] };

  if (isJsonArray(value)) {
    const items = value.map((item) => toJsonNode(item));

    return { read: () => ["array", items] };
  }

  if (isJsonObject(value)) {
    const fields = new Map<string, JsonNode>();

    for (const [key, item] of Object.entries(value)) {
      fields.set(key, toJsonNode(item));
    }

    return { read: () => ["object", fields] };
  }

  if (isJsonText(value)) return { read: () => ["text", value] };

  if (value === true) return { read: () => ["boolean", true] };

  if (value === false) return { read: () => ["boolean", false] };

  return { read: () => ["number", value] };
}

export function parseJson(text: string): JsonNode {
  const parsed: unknown = JSON.parse(text);

  if (!isJsonInput(parsed)) throw new Error("unsupported JSON value");

  return toJsonNode(parsed);
}

export function requireObject(node: JsonNode, label: string): JsonFields {
  const value = node.read();

  if (value[0] !== "object") throw new Error(`${label}: expected an object`);

  return value[1];
}

export function requireArray(node: JsonNode, label: string): readonly JsonNode[] {
  const value = node.read();

  if (value[0] !== "array") throw new Error(`${label}: expected an array`);

  return value[1];
}

export function requireText(node: JsonNode, label: string): string {
  const value = node.read();

  if (value[0] !== "text" || value[1].length === 0) {
    throw new Error(`${label}: expected a non-empty string`);
  }

  return value[1];
}

export function requireInteger(node: JsonNode, label: string, minimum = 0): number {
  const value = node.read();

  if (value[0] !== "number" || !Number.isSafeInteger(value[1]) || value[1] < minimum) {
    throw new Error(`${label}: expected a safe integer >= ${minimum}`);
  }

  return value[1];
}

export function requireField(fields: JsonFields, key: string, label: string): JsonNode {
  const node = fields.get(key);

  if (node === undefined) throw new Error(`${label}: missing field ${key}`);

  return node;
}

export function optionalField(fields: JsonFields, key: string): JsonNode | undefined {
  return fields.get(key);
}

export function requireExactKeys(
  fields: JsonFields,
  expected: readonly string[],
  label: string,
): void {
  if (fields.size !== expected.length || expected.some((key) => !fields.has(key))) {
    throw new Error(`${label}: expected exactly ${expected.join(", ")}`);
  }
}
