import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestCentral } from "./testdata/webCentral.js";
import { createWebBluetoothTransport } from "./webBluetoothTransport.js";
import { createNavigatorBluetoothCentral } from "./webBluetoothTypes.js";
import { isWebBluetoothCentral } from "./webBluetoothGuards.js";
import { HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT } from "./uuids.js";
import { toHex, readerBytes } from "./bytes.js";

const scan = {
  acceptAllDevices: false,
  filters: [{ services: [HEART_RATE_SERVICE], namePrefix: "Test" }],
  optionalServices: [],
};

const ref = { serviceUuid: HEART_RATE_SERVICE, characteristicUuid: HEART_RATE_MEASUREMENT };

afterEach(() => vi.unstubAllGlobals());

describe("Web Bluetooth boundary", () => {
  it("discovers, reads, writes and subscribes the selected device", async () => {
    const fake = createTestCentral();
    const transport = createWebBluetoothTransport({ central: fake.central });
    expect(transport.deviceName()).toBe("unknown device");
    expect(transport.deviceId()).toBe("unknown");
    const profile = await transport.connect(scan);
    expect(profile.services[0]?.characteristics[0]).toMatchObject({
      uuid: HEART_RATE_MEASUREMENT,
      properties: ["read", "write", "writeWithoutResponse", "notify", "indicate"],
    });
    expect(transport.deviceName()).toBe("Test strap");
    expect(transport.deviceId()).toBe("strap-1");
    expect((await transport.read(ref)).getUint8(1)).toBe(64);
    await transport.write(ref, Uint8Array.from([1, 2]));
    expect(fake.writes()).toHaveLength(1);
    const frames: string[] = [];

    const stop = await transport.subscribe(ref, (data) => {
      frames.push(toHex(readerBytes(data)));
    });

    fake.notify();
    expect(frames).toEqual(["00 40"]);
    stop();
    fake.notify();
    expect(frames).toEqual(["00 40"]);
    await transport.connect(scan);
    expect(fake.stops()).toBe(1);
    expect(fake.requests()).toHaveLength(1);
    expect(fake.connects()).toBe(2);
    await transport.disconnect();
    await expect(transport.read(ref)).rejects.toThrow("connected");
  });
});

describe("advertisement and disconnect lifecycle", () => {
  it("normalizes advertisement payloads and unregisters listeners", async () => {
    const fake = createTestCentral();
    const transport = createWebBluetoothTransport({ central: fake.central });
    await transport.connect({ acceptAllDevices: true, filters: [], optionalServices: [] });
    const frames: string[] = [];

    const stop = transport.watchAdvertisements((frame) => {
      frames.push(JSON.stringify(frame));
    });

    const payload = {
      rssi: -42,
      txPower: 1,
      manufacturerData: new Map([[2378, new DataView(Uint8Array.from([1, 2]).buffer)]]),
      serviceData: new Map([["0x180d", new DataView(Uint8Array.from([3]).buffer)]]),
    };

    fake.event("advertisementreceived", payload);
    expect(frames.join()).toContain('"rssiDbm":-42');
    expect(frames.join()).toContain(HEART_RATE_SERVICE);
    stop();
    fake.event("advertisementreceived", payload);
    expect(frames).toHaveLength(1);
    let disconnected = 0;

    const unlisten = transport.onDisconnected(() => {
      disconnected += 1;
    });

    fake.event("gattserverdisconnected", payload);
    expect(disconnected).toBe(1);
    unlisten();
    fake.event("gattserverdisconnected", payload);
    expect(disconnected).toBe(1);
  });
});

describe("browser availability", () => {
  it("returns only the browser's available central", () => {
    vi.stubGlobal("navigator", { userAgent: "vitest" });
    expect(createNavigatorBluetoothCentral()).toBeUndefined();
    vi.stubGlobal("navigator", { userAgent: "vitest", bluetooth: null });
    expect(createNavigatorBluetoothCentral()).toBeUndefined();
    const fake = createTestCentral();
    vi.stubGlobal("navigator", { userAgent: "vitest", bluetooth: fake.central });
    expect(createNavigatorBluetoothCentral()).toBe(fake.central);
    expect(isWebBluetoothCentral(null)).toBe(false);
  });
});
