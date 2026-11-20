import { expect, it } from "vitest";
import { createTestCentral } from "./testdata/webCentral.js";
import { createWebBluetoothTransport } from "./webBluetoothTransport.js";
import { HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT } from "./uuids.js";

const scan = { acceptAllDevices: true, filters: [], optionalServices: [] };
const ref = { serviceUuid: HEART_RATE_SERVICE, characteristicUuid: HEART_RATE_MEASUREMENT };

it("remembers a rejected selection without taking ownership or opening another picker on retry", async () => {
  const first = createTestCentral();
  const replacement = createTestCentral();
  let selected = first.device;
  let requests = 0;

  const central = {
    requestDevice: () => {
      requests += 1;

      return Promise.resolve(selected);
    },
  };

  const owner = createWebBluetoothTransport({ central });
  const other = createWebBluetoothTransport({ central });
  await owner.connect(scan);
  let received = 0;
  await owner.subscribe(ref, () => {
    received += 1;
  });
  await expect(other.connect(scan, "select")).rejects.toThrow("anderen Verbindung");
  await expect(other.connect(scan, "remembered")).rejects.toThrow("anderen Verbindung");
  expect(requests).toBe(2);
  expect(other.deviceId()).toBe("strap-1");
  selected = { ...replacement.device, id: "different-device" };
  await other.connect(scan, "select");
  first.notify();
  expect(received).toBe(1);
  expect(first.stops()).toBe(0);
  await other.disconnect();
  await owner.disconnect();
});

it("a former owner cannot disconnect the current owner after a conflicting retry", async () => {
  const fake = createTestCentral();
  const old = createWebBluetoothTransport({ central: fake.central });
  const current = createWebBluetoothTransport({ central: fake.central });
  await old.connect(scan);
  await old.disconnect();
  expect(old.deviceId()).toBe("strap-1");
  expect(old.deviceName()).toBe("Test strap");
  await current.connect(scan);
  let received = 0;
  await current.subscribe(ref, () => {
    received += 1;
  });
  await expect(old.connect(scan)).rejects.toThrow("anderen Verbindung");
  const before = fake.disconnects();
  await old.disconnect();
  expect(fake.disconnects() - before).toBe(0);
  fake.notify();
  expect(received).toBe(1);
  await current.disconnect();
});

it("selecting a replacement never disconnects the former device now owned by another slot", async () => {
  const first = createTestCentral();
  const replacement = createTestCentral();
  let selected = first.device;
  const central = { requestDevice: () => Promise.resolve(selected) };
  const old = createWebBluetoothTransport({ central });
  const current = createWebBluetoothTransport({ central });
  await old.connect(scan);
  await old.disconnect();
  await current.connect(scan);
  let received = 0;
  await current.subscribe(ref, () => {
    received += 1;
  });
  selected = { ...replacement.device, id: "replacement" };
  const before = first.disconnects();
  await old.connect(scan, "select");
  expect(first.disconnects() - before).toBe(0);
  first.notify();
  expect(received).toBe(1);
  await old.disconnect();
  await current.disconnect();
});

function noop(): void {}

function deferred() {
  let resolve = noop;

  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });

  return {
    promise,
    resolve: () => {
      resolve();
    },
  };
}

it("keeps ownership until queued native teardown completes and never resurrects an old listener", async () => {
  const gate = deferred();
  const fake = createTestCentral({ stopNotifications: () => gate.promise });
  const old = createWebBluetoothTransport({ central: fake.central });
  const current = createWebBluetoothTransport({ central: fake.central });
  await old.connect(scan);
  let oldPackets = 0;
  await old.subscribe(ref, () => {
    oldPackets += 1;
  });

  const staleDisconnect = fake.captureEvent("gattserverdisconnected", {
    manufacturerData: new Map(),
    serviceData: new Map(),
  });

  const stopping = old.disconnect();
  await expect.poll(fake.stops).toBe(1);
  await expect(current.connect(scan)).rejects.toThrow("anderen Verbindung");
  fake.notify();
  expect(oldPackets).toBe(0);
  gate.resolve();
  await stopping;
  await current.connect(scan);
  let currentPackets = 0;
  let currentDrops = 0;
  current.onDisconnected(() => {
    currentDrops += 1;
  });
  await current.subscribe(ref, () => {
    currentPackets += 1;
  });
  staleDisconnect();
  await old.disconnect();
  fake.notify();
  expect(currentDrops).toBe(0);
  expect(currentPackets).toBe(1);
  expect(oldPackets).toBe(0);
  await current.disconnect();
});

function firstConnectGate() {
  const gate = deferred();
  let attempts = 0;

  return {
    release: gate.resolve,
    connect: () => {
      attempts += 1;

      return attempts === 1 ? gate.promise : Promise.resolve();
    },
  };
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "unexpected failure";
}

it("cancels an in-flight connection before another owner can use it and ignores its old event", async () => {
  const gate = firstConnectGate();
  const fake = createTestCentral({ beforeConnect: gate.connect });
  const old = createWebBluetoothTransport({ central: fake.central });
  const current = createWebBluetoothTransport({ central: fake.central });
  const oldRejected = old.connect(scan).then(() => "connected", failureMessage);
  await expect.poll(fake.connects).toBe(1);

  const staleDisconnect = fake.captureEvent("gattserverdisconnected", {
    manufacturerData: new Map(),
    serviceData: new Map(),
  });

  const stopping = old.disconnect();
  await expect(current.connect(scan)).rejects.toThrow("anderen Verbindung");
  await expect(old.read(ref)).rejects.toThrow("not connected");
  gate.release();
  expect(await oldRejected).toContain("not connected");
  await stopping;
  await current.connect(scan);
  let packets = 0;
  let drops = 0;
  await current.subscribe(ref, () => {
    packets += 1;
  });
  current.onDisconnected(() => {
    drops += 1;
  });
  staleDisconnect();
  fake.notify();
  expect(packets).toBe(1);
  expect(drops).toBe(0);
  expect(fake.disconnects()).toBe(1);
  await current.disconnect();
});

it("retains remembered metadata while detaching old advertisement observers from a released device", async () => {
  const fake = createTestCentral();
  const old = createWebBluetoothTransport({ central: fake.central });
  const current = createWebBluetoothTransport({ central: fake.central });
  const advertisement = { manufacturerData: new Map(), serviceData: new Map() };
  await old.connect(scan);
  let oldFrames = 0;

  const stop = old.watchAdvertisements(() => {
    oldFrames += 1;
  });

  const staleAdvertisement = fake.captureEvent("advertisementreceived", advertisement);
  await old.disconnect();
  expect(old.deviceId()).toBe("strap-1");
  expect(old.deviceName()).toBe("Test strap");
  await current.connect(scan);
  let currentFrames = 0;
  current.watchAdvertisements(() => {
    currentFrames += 1;
  });
  fake.event("advertisementreceived", advertisement);
  staleAdvertisement();
  expect(oldFrames).toBe(0);
  expect(currentFrames).toBe(1);
  stop();
  fake.event("advertisementreceived", advertisement);
  expect(currentFrames).toBe(2);
  await current.disconnect();
  fake.event("advertisementreceived", advertisement);
  expect(currentFrames).toBe(2);
});

it("releases ownership after disconnect and rejects a conflicting reconnect", async () => {
  const first = createTestCentral();
  const owner = createWebBluetoothTransport({ central: first.central });
  const next = createWebBluetoothTransport({ central: first.central });
  await owner.connect(scan);
  await owner.disconnect();
  await next.connect(scan);
  await expect(owner.connect(scan)).rejects.toThrow("anderen Verbindung");
  await next.disconnect();
  await owner.connect(scan);
  await owner.disconnect();
});
