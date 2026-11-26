import { characteristicLabel, type BleLogEntry } from "@voltonaut/ble";

const EVENT_TEXT = new Map([
  ["connected", "verbunden"],
  ["disconnected", "Verbindung verloren"],
  ["disconnected-manual", "getrennt"],
  ["encrypted-handshake", "verschlüsselte Antwort"],
  ["auto-capture-failed", "automatische Aufnahme"],
]);

function seconds(tMs: number): string {
  return `${(tMs / 1000).toFixed(3).padStart(9)} s`;
}

/** One readable log line: time, direction, characteristic, bytes and decoded value. */
export function formatLogEntry(entry: BleLogEntry): string {
  if (entry.kind === "event") {
    if (entry.event === "marker") {
      return `${seconds(entry.tMs)}  ● ${entry.marker}`;
    }

    const text = EVENT_TEXT.get(entry.event) ?? entry.event;

    return `${seconds(entry.tMs)}  ○ ${text}${entry.marker === "" ? "" : `: ${entry.marker}`}`;
  }

  const decoded = entry.decoded === "" ? "" : `  → ${entry.decoded}`;

  return `${seconds(entry.tMs)}  ${entry.dir}  ${characteristicLabel(entry.char)}  ${entry.hex}${decoded}`;
}

export interface LogCounts {
  readonly received: number;
  readonly sent: number;
  readonly markers: number;
}

export function countLog(entries: readonly BleLogEntry[]): LogCounts {
  let received = 0;
  let sent = 0;
  let markers = 0;

  for (const entry of entries) {
    if (entry.kind === "data") {
      if (entry.dir === "rx") received += 1;
      else sent += 1;
    } else if (entry.event === "marker") {
      markers += 1;
    }
  }

  return { received, sent, markers };
}
