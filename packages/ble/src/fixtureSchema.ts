import { z } from "zod";

import { parseFailure, type ParseResult } from "./bytes.js";
import type { GattProperty } from "./transport.js";

/**
 * Zod schemas for sniffer exports and replay fixtures (docs/10-testing.md section 2,
 * docs/specs/E1-01-ble-sniffer-pulse-ftms.md "Fixture-Format & Replay-Tests").
 */

export const BLE_FIXTURE_SCHEMA_VERSION = 1;

export type BleProtocol = "ftms" | "hrs" | "cps" | "zwift-play" | "raw";

const HEX_BYTES_PATTERN = /^(?:[0-9a-f]{2}(?: [0-9a-f]{2})*)?$/u;
const SHORT_UUID_PATTERN = /^0x[0-9a-fA-F]{4}$/u;

const UUID_128_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|[zZ])$/u;

const uuidSchema = z.string().regex(SHORT_UUID_PATTERN).or(z.string().regex(UUID_128_PATTERN));

const gattPropertySchema = z.enum(["read", "write", "writeWithoutResponse", "notify", "indicate"]);

const gattCharacteristicSchema = z.object({
  char: uuidSchema,
  properties: z.array(gattPropertySchema).min(1),
  descriptors: z.array(uuidSchema).default([]),
});

const gattServiceSchema = z.object({
  service: uuidSchema,
  characteristics: z.array(gattCharacteristicSchema).min(1),
});

const logDataExchangeSchema = z.object({
  tMs: z.number().finite().nonnegative(),
  device: z.string(),
  service: uuidSchema,
  char: uuidSchema,
  hex: z.string().regex(HEX_BYTES_PATTERN),
  ascii: z.string().default(""),
  decoded: z.string().default(""),
  marker: z.string().default(""),
});

const logRxEntrySchema = logDataExchangeSchema.extend({ dir: z.literal("rx") });

const logTxEntrySchema = logDataExchangeSchema.extend({ dir: z.literal("tx") });

const logEventEntrySchema = z.object({
  tMs: z.number().finite().nonnegative(),
  device: z.string(),
  event: z.string().min(1),
  marker: z.string().default(""),
});

const logEntrySchema = z.union([logRxEntrySchema, logTxEntrySchema, logEventEntrySchema]);

const metaSchema = z.object({
  schemaVersion: z.literal(BLE_FIXTURE_SCHEMA_VERSION),
  ua: z.string(),
  date: z.string().regex(ISO_DATE_PATTERN),
  deviceName: z.string(),
  deviceId: z.string(),
  firmware: z.string().default(""),
  protocol: z.enum(["ftms", "hrs", "cps", "zwift-play", "raw"]),
  notes: z.string().default(""),
});

export const bleFixtureSchema = z.object({
  meta: metaSchema,
  gatt: z.array(gattServiceSchema),
  log: z.array(logEntrySchema),
});

/** Parsed domain shapes; every defaulted field is present after parsing. */

export interface BleFixtureMeta {
  readonly schemaVersion: 1;
  readonly ua: string;
  readonly date: string;
  readonly deviceName: string;
  readonly deviceId: string;
  readonly firmware: string;
  readonly protocol: BleProtocol;
  readonly notes: string;
}

export interface BleGattCharacteristic {
  readonly char: string;
  readonly properties: readonly GattProperty[];
  readonly descriptors: readonly string[];
}

export interface BleGattService {
  readonly service: string;
  readonly characteristics: readonly BleGattCharacteristic[];
}

export type BleLogEntry =
  | {
      readonly kind: "data";
      readonly tMs: number;
      readonly device: string;
      readonly service: string;
      readonly char: string;
      readonly dir: "rx" | "tx";
      readonly hex: string;
      readonly ascii: string;
      readonly decoded: string;
      readonly marker: string;
    }
  | {
      readonly kind: "event";
      readonly tMs: number;
      readonly device: string;
      readonly event: string;
      readonly marker: string;
    };

export interface BleFixture {
  readonly meta: BleFixtureMeta;
  readonly gatt: readonly BleGattService[];
  readonly log: readonly BleLogEntry[];
}

type ZodBleLogEntry = z.infer<typeof logEntrySchema>;

/** Fixture parse outcome; a failure never throws (docs/10-testing.md section 2). */
export type BleFixtureParseResult = ParseResult<BleFixture>;

interface FixtureIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

function issueText(issues: readonly FixtureIssue[]): string {
  const firstIssue = issues[0];

  if (firstIssue === undefined) {
    return "invalid fixture";
  }

  const path = firstIssue.path.length > 0 ? `${firstIssue.path.join(".")}: ` : "";

  return `${path}${firstIssue.message}`;
}

function hasMonotonicTimes(log: readonly BleLogEntry[]): boolean {
  let lastTMs = 0;

  for (const entry of log) {
    if (entry.tMs < lastTMs) {
      return false;
    }

    lastTMs = entry.tMs;
  }

  return true;
}

function toEventEntry(entry: Extract<ZodBleLogEntry, { event: string }>): BleLogEntry {
  return {
    kind: "event",
    tMs: entry.tMs,
    device: entry.device,
    event: entry.event,
    marker: entry.marker,
  };
}

function toDataEntry(entry: Exclude<ZodBleLogEntry, { event: string }>): BleLogEntry {
  return {
    kind: "data",
    tMs: entry.tMs,
    device: entry.device,
    service: entry.service,
    char: entry.char,
    dir: entry.dir,
    hex: entry.hex,
    ascii: entry.ascii,
    decoded: entry.decoded,
    marker: entry.marker,
  };
}

/**
 * Parse a fixture from its JSON text (a sniffer export). Invalid JSON or a
 * nonconforming shape yields a failure object, never a throw.
 */
export function parseBleFixtureJson(text: string): BleFixtureParseResult {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return parseFailure("fixture rejected: not valid JSON");
  }

  const parsed = bleFixtureSchema.safeParse(raw);

  if (!parsed.success) {
    return parseFailure(`fixture rejected: ${issueText(parsed.error.issues)}`);
  }

  const entries: BleLogEntry[] = [];

  for (const entry of parsed.data.log) {
    entries.push("event" in entry ? toEventEntry(entry) : toDataEntry(entry));
  }

  if (!hasMonotonicTimes(entries)) {
    return parseFailure("fixture rejected: log entries must not go back in tMs");
  }

  return { ok: true, value: { meta: parsed.data.meta, gatt: parsed.data.gatt, log: entries } };
}
