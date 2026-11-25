import { describe, expect, it } from "vitest";
import {
  bytesToDataView,
  createManualClock,
  createManualTicker,
  toHex,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FTMS_CONTROL_POINT_REF,
  FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET,
  FTMS_SIM_FIVE_PRESET,
  type BleTransport,
  type GattProfile,
  type NotificationListener,
} from "@voltonaut/ble";
import { LabDevice } from "./device.js";
import { preset } from "./presets.js";

const scan = { acceptAllDevices: true, filters: [], optionalServices: [] };

const PROFILE: GattProfile = {
  services: [
    {
      uuid: FITNESS_MACHINE_SERVICE,
      characteristics: [
        { uuid: FITNESS_MACHINE_CONTROL_POINT, properties: ["write", "indicate"], descriptors: [] },
      ],
    },
  ],
};

async function settle(rounds = 30): Promise<void> {
  if (rounds === 0) return;
  await Promise.resolve();
  await settle(rounds - 1);
}

class LabTrainer {
  readonly writes: string[] = [];
  private readonly clock = createManualClock();
  private readonly ticker = createManualTicker();
  private readonly listeners = new Set<NotificationListener>();
  private readonly disconnected = new Set<() => void>();
  private autoAck = true;

  readonly transport: BleTransport = {
    deviceName: () => "Lab trainer",
    deviceId: () => "lab-1",
    connect: () => Promise.resolve(PROFILE),
    read: () => Promise.resolve(bytesToDataView(Uint8Array.of(0))),
    write: (_ref, bytes) => {
      this.writes.push(toHex(bytes));

      if (this.autoAck) this.indicate([0x80, bytes.at(0) ?? -1, 1]);

      return Promise.resolve();
    },
    subscribe: (_ref, listener) => {
      this.listeners.add(listener);

      return Promise.resolve(() => {
        this.listeners.delete(listener);
      });
    },
    watchAdvertisements: () => () => {},
    onDisconnected: (listener) => {
      this.disconnected.add(listener);

      return () => {
        this.disconnected.delete(listener);
      };
    },
    disconnect: () => Promise.resolve(),
  };

  readonly device = new LabDevice(
    1,
    "lab-1",
    "Lab trainer",
    this.transport,
    { clock: this.clock, ticker: this.ticker },
    () => {},
  );

  indicate(bytes: readonly number[]): void {
    for (const listener of this.listeners) listener(bytesToDataView(Uint8Array.from(bytes)));
  }

  ack(enabled: boolean): void {
    this.autoAck = enabled;
  }

  drop(): void {
    for (const listener of this.disconnected) listener();
  }

  async advance(s: number): Promise<void> {
    this.clock.advanceS(s);
    this.ticker.tick();
    await settle();
  }

  /** Acquires control, then lets the Sim 5 % ACK go missing past the 3-s deadline. */
  async timeOutSimFive(): Promise<{ readonly pending: Promise<void> }> {
    await this.device.connect(scan);
    await preset(this.device, FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    this.ack(false);
    const pending = preset(this.device, FTMS_SIM_FIVE_PRESET);
    // Observed by the caller's `rejects`; attach a handler so the deadline cannot reject unobserved.
    pending.catch(() => {});
    await settle();
    await this.advance(3);

    return { pending };
  }

  log(): readonly string[] {
    return this.device.session
      .fixture("", "")
      .log.flatMap((entry) => (entry.kind === "data" ? [`${entry.dir} ${entry.hex}`] : []));
  }
}

function labTrainer(): LabTrainer {
  return new LabTrainer();
}

describe("lab FTMS presets", () => {
  it("run Request Control, Start and Sim 0 % through the logging transport", async () => {
    const lab = labTrainer();
    await lab.device.connect(scan);
    await preset(lab.device, FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    await preset(lab.device, FTMS_SIM_FIVE_PRESET);
    expect(lab.writes).toEqual(["00", "07", "11 00 00 00 00 28 33", "11 00 00 f4 01 28 33"]);
    // The fake acknowledges inside the write, before the logger records tx; compare per direction.
    expect(lab.log().filter((line) => line.startsWith("tx"))).toEqual([
      "tx 00",
      "tx 07",
      "tx 11 00 00 00 00 28 33",
      "tx 11 00 00 f4 01 28 33",
    ]);
    expect(lab.log().filter((line) => line.startsWith("rx"))).toEqual([
      "rx 80 00 01",
      "rx 80 07 01",
      "rx 80 11 01",
      "rx 80 11 01",
    ]);
  });
});

describe("lab FTMS presets after a missing ACK", () => {
  it("write nothing more to the control point while the log keeps recording", async () => {
    const lab = labTrainer();
    const { pending } = await lab.timeOutSimFive();
    await expect(pending).rejects.toThrow("Neu verbinden");
    lab.ack(true);
    await expect(preset(lab.device, FTMS_SIM_FIVE_PRESET)).rejects.toThrow("gesperrt");
    await expect(preset(lab.device, FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET)).rejects.toThrow(
      "gesperrt",
    );
    lab.indicate([0x80, 0x11, 0x01]);
    expect(lab.writes).toHaveLength(4);
    expect(lab.log().slice(-2)).toEqual(["tx 11 00 00 f4 01 28 33", "rx 80 11 01"]);
    expect(lab.log().filter((line) => line.startsWith("tx"))).toHaveLength(4);
  });

  it("let a late ACK satisfy nothing; only a reconnect restores control", async () => {
    const lab = labTrainer();
    const { pending } = await lab.timeOutSimFive();
    await expect(pending).rejects.toThrow("Neu verbinden");
    lab.indicate([0x80, 0x11, 0x01]);
    await expect(preset(lab.device, FTMS_SIM_FIVE_PRESET)).rejects.toThrow("gesperrt");
    expect(lab.device.ftms?.view().kind).toBe("unusable");
    lab.ack(true);
    await lab.device.connect(scan);
    await expect(preset(lab.device, FTMS_SIM_FIVE_PRESET)).rejects.toThrow("Zuerst FTMS");
    await preset(lab.device, FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    expect(lab.device.ftms?.view()).toEqual({ kind: "granted" });
    expect(lab.writes.slice(4)).toEqual(["00", "07", "11 00 00 00 00 28 33"]);
  });
});

describe("lab FTMS authority", () => {
  it("is cleared by an unexpected disconnect", async () => {
    const lab = labTrainer();
    await lab.device.connect(scan);
    await preset(lab.device, FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    lab.drop();
    await expect(preset(lab.device, FTMS_SIM_FIVE_PRESET)).rejects.toThrow("getrennt");
    expect(lab.writes).toHaveLength(3);
  });

  it("is cleared by a raw explorer write to the control point", async () => {
    const lab = labTrainer();
    await lab.device.connect(scan);
    await preset(lab.device, FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    lab.device.rawWrite({ ...FTMS_CONTROL_POINT_REF, characteristicUuid: "00002ad2-0000" });
    await preset(lab.device, FTMS_SIM_FIVE_PRESET);
    lab.device.rawWrite(FTMS_CONTROL_POINT_REF);
    await expect(preset(lab.device, FTMS_SIM_FIVE_PRESET)).rejects.toThrow("Rohwrite");
    expect(lab.writes).toHaveLength(4);
  });

  it("refuses presets before connecting", async () => {
    const lab = labTrainer();
    await expect(preset(lab.device, FTMS_SIM_FIVE_PRESET)).rejects.toThrow("Zuerst verbinden");
    expect(lab.writes).toEqual([]);
  });
});
