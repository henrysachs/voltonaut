import { expect, it } from "vitest";
import { bytesToDataView, parseHex } from "./bytes.js";
import {
  characteristicLabel,
  decodeDeviceText,
  decodeLabFrame,
  describeAdvertisement,
  labDeviceGuide,
  labDeviceKind,
  labReadableCharacteristics,
  labRecordedCharacteristics,
} from "./index.js";
import type { GattProfile, GattProperty } from "./transport.js";
import { CLICK_V2_PROFILE } from "./testdata/playRig.js";

function view(hex: string): DataView {
  const bytes = parseHex(hex);

  if (bytes === undefined) throw new Error("invalid test hex");

  return bytesToDataView(bytes);
}

function uuid(short: string): string {
  return `0000${short}-0000-1000-8000-00805f9b34fb`;
}

function zwift(short: string): string {
  return `0000000${short}-19ca-4651-86e5-fa29dcdd09d1`;
}

function characteristic(id: string, properties: readonly GattProperty[]) {
  return { uuid: id, properties, descriptors: [] };
}

/** GATT layout of the Zwift Hub One from the 2026-11-26 export (bytes not committed). */
const HUB_PROFILE: GattProfile = {
  services: [
    {
      uuid: uuid("180a"),
      characteristics: ["2a24", "2a26", "2a27", "2a29"].map((id) =>
        characteristic(uuid(id), ["read"]),
      ),
    },
    {
      uuid: uuid("180d"),
      characteristics: [
        characteristic(uuid("2a37"), ["notify"]),
        characteristic(uuid("2a38"), ["read"]),
      ],
    },
    {
      uuid: zwift("1"),
      characteristics: [
        characteristic(zwift("2"), ["notify"]),
        characteristic(zwift("3"), ["writeWithoutResponse"]),
        characteristic(zwift("4"), ["read", "indicate"]),
      ],
    },
    {
      uuid: uuid("1826"),
      characteristics: [
        characteristic(uuid("2acc"), ["read"]),
        characteristic(uuid("2ad2"), ["notify"]),
        characteristic(uuid("2ad6"), ["read"]),
        characteristic(uuid("2ad8"), ["read"]),
        characteristic(uuid("2ad9"), ["write", "indicate"]),
        characteristic(uuid("2ada"), ["notify"]),
      ],
    },
    {
      uuid: uuid("1818"),
      characteristics: [
        characteristic(uuid("2a5d"), ["read"]),
        characteristic(uuid("2a63"), ["notify"]),
        characteristic(uuid("2a65"), ["read"]),
        characteristic(uuid("2a66"), ["write", "indicate"]),
      ],
    },
  ],
};

const CLICK_FULL: GattProfile = {
  services: [
    {
      uuid: uuid("180f"),
      characteristics: [characteristic(uuid("2a19"), ["read", "notify"])],
    },
    ...CLICK_V2_PROFILE.services,
  ],
};

it("classifies the Hub as an FTMS trainer even though it offers the Zwift service", () => {
  expect(labDeviceKind(HUB_PROFILE)).toEqual({ kind: "trainer", ftmsControl: true });
  expect(labDeviceKind(CLICK_FULL)).toEqual({ kind: "controller", family: "clickV2" });
  expect(labDeviceKind({ services: [] })).toEqual({ kind: "unknown" });
  expect(
    labDeviceKind({
      services: [
        { uuid: uuid("180d"), characteristics: [characteristic(uuid("2a37"), ["notify"])] },
      ],
    }),
  ).toEqual({ kind: "heartRate" });
});

it("records every standard notify/indicate channel of the Hub but never its Zwift service (ADR-001)", () => {
  const recorded = labRecordedCharacteristics(HUB_PROFILE).map((ref) => ref.characteristicUuid);
  expect(recorded).toEqual([
    uuid("2a37"),
    uuid("2ad2"),
    uuid("2ad9"),
    uuid("2ada"),
    uuid("2a63"),
    uuid("2a66"),
  ]);
});

it("leaves the Click v2 characteristics of unknown purpose to the explorer", () => {
  const recorded = labRecordedCharacteristics(CLICK_FULL).map((ref) => ref.characteristicUuid);
  expect(recorded).toEqual([uuid("2a19"), zwift("2"), zwift("4")]);
});

it("reads only standard characteristics automatically", () => {
  const read = labReadableCharacteristics(HUB_PROFILE).map((ref) => ref.characteristicUuid);
  expect(read).toContain(uuid("2a26"));
  expect(read).toContain(uuid("2acc"));
  expect(read).not.toContain(zwift("4"));
});

it("gives each device kind its own capture guide", () => {
  expect(labDeviceGuide(HUB_PROFILE).title).toBe("Trainer mit FTMS-Steuerung");
  expect(labDeviceGuide(CLICK_FULL).steps.join(" ")).toContain("Zwift-App");
  expect(labDeviceGuide({ services: [] }).steps.join(" ")).toContain("Marker");
});

it("decodes the bytes seen at the Hub and a Click v2 into readable text", () => {
  const ftms = uuid("1826");
  expect(
    decodeLabFrame({ serviceUuid: ftms, characteristicUuid: uuid("2ad9") }, view("80 07 04")),
  ).toBe("Antwort auf 0x07: failed");
  expect(decodeLabFrame({ serviceUuid: ftms, characteristicUuid: uuid("2ada") }, view("04"))).toBe(
    "Started/Resumed by user",
  );
  expect(
    decodeLabFrame(
      { serviceUuid: ftms, characteristicUuid: uuid("2ada") },
      view("12 00 00 00 00 28 33"),
    ),
  ).toBe("Indoor bike simulation changed");
  expect(
    decodeLabFrame(
      { serviceUuid: uuid("180a"), characteristicUuid: uuid("2a26") },
      view("31 2e 32 00"),
    ),
  ).toBe("Firmware: 1.2");
  expect(
    decodeLabFrame({ serviceUuid: uuid("180f"), characteristicUuid: uuid("2a19") }, view("57")),
  ).toBe("Akku 87 %");

  const fc82 = uuid("fc82");
  expect(
    decodeLabFrame(
      { serviceUuid: fc82, characteristicUuid: zwift("2") },
      view("23 08 ff df ff ff 0f"),
    ),
  ).toContain('"clickV2":"plus"');
  expect(
    decodeLabFrame(
      { serviceUuid: fc82, characteristicUuid: zwift("4") },
      view("52 69 64 65 4f 6e 02 03 aa"),
    ),
  ).toBe("RideOn + 02 03 aa");
  expect(
    decodeLabFrame({ serviceUuid: fc82, characteristicUuid: zwift("2") }, view("ff 05 00 ea 05")),
  ).toContain("gesperrt");
  expect(decodeLabFrame({ serviceUuid: fc82, characteristicUuid: zwift("2") }, view("15"))).toBe(
    "",
  );
});

it("names characteristics and Zwift device types for the log", () => {
  expect(characteristicLabel(uuid("2ad9"))).toBe("FTMS Control Point");
  expect(characteristicLabel("0x2A26")).toBe("Firmware");
  expect(characteristicLabel("00000100-19ca-4651-86e5-fa29dcdd09d1")).toBe(
    "00000100-19ca-4651-86e5-fa29dcdd09d1",
  );
  expect(
    describeAdvertisement({
      rssiDbm: -60,
      manufacturerData: [{ companyId: 0x094a, data: Uint8Array.of(0x0b, 0x01) }],
      serviceData: [],
    }),
  ).toBe("Signal: -60 dBm\nHersteller 0x094a: 0b 01 → Zwift Click v2 links (−)");
  expect(describeAdvertisement({ manufacturerData: [], serviceData: [] })).toBe(
    "Advertising ohne Inhalt",
  );
  expect(decodeDeviceText(view("48 75 62 00 00"))).toBe("Hub");
});
