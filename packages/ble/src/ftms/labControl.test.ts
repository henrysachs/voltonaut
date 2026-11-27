import { describe, expect, it } from "vitest";
import { bytesToDataView, toHex, type ReadOnlyBytes } from "../bytes.js";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import type { GattProfile, NotificationListener } from "../transport.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
} from "../uuids.js";
import { RIDE_ON, RIDE_ON_CLICK_V2 } from "../zwift-play/handshake.js";
import { settle } from "./controlTestRig.js";
import { createFtmsLabControl, isFtmsControlPoint } from "./labControl.js";
import {
  FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET,
  FTMS_SIM_FIVE_PRESET,
  ZWIFT_CONTROLLER_HANDSHAKE_PRESET,
} from "./presets.js";

const PROFILE: GattProfile = {
  services: [
    {
      uuid: FITNESS_MACHINE_SERVICE,
      characteristics: [
        { uuid: FITNESS_MACHINE_CONTROL_POINT, properties: ["write", "indicate"], descriptors: [] },
        { uuid: FITNESS_MACHINE_STATUS, properties: ["notify"], descriptors: [] },
      ],
    },
  ],
};

function labRig(profile: GattProfile = PROFILE) {
  const clock = createManualClock();
  const ticker = createManualTicker();
  const writes: string[] = [];
  const listeners = new Map<string, NotificationListener>();
  let autoAck = true;

  const notify = (bytes: readonly number[]): void => {
    listeners.get(FITNESS_MACHINE_CONTROL_POINT)?.(bytesToDataView(Uint8Array.from(bytes)));
  };

  const control = createFtmsLabControl({
    clock,
    ticker,
    profile,
    transport: {
      subscribe: (ref, listener) => {
        listeners.set(ref.characteristicUuid, listener);

        return Promise.resolve(() => {
          listeners.delete(ref.characteristicUuid);
        });
      },
      write: (_ref, bytes: ReadOnlyBytes) => {
        writes.push(toHex(bytes));

        if (autoAck) notify([0x80, bytes.at(0) ?? -1, 1]);

        return Promise.resolve();
      },
    },
  });

  return {
    control,
    writes,
    notify,
    status: (opcode: number) => {
      listeners.get(FITNESS_MACHINE_STATUS)?.(bytesToDataView(Uint8Array.of(opcode)));
    },
    ack: (enabled: boolean) => {
      autoAck = enabled;
    },
    advance: async (s: number) => {
      clock.advanceS(s);
      ticker.tick();
      await settle();
    },
  };
}

describe("lab preset definitions", () => {
  it("keeps the ride's acquire order and the documented simulation bytes", () => {
    expect(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET.commands.map((step) => step.opcode)).toEqual([
      0x00, 0x07, 0x11,
    ]);
    expect(FTMS_SIM_FIVE_PRESET.commands.map((step) => toHex(step.bytes))).toEqual([
      "11 00 00 f4 01 28 33",
    ]);
    expect(toHex(RIDE_ON)).toBe("52 69 64 65 4f 6e");
    expect(toHex(RIDE_ON_CLICK_V2)).toBe("52 69 64 65 4f 6e 02 03");
    expect(ZWIFT_CONTROLLER_HANDSHAKE_PRESET.kind).toBe("zwiftController");
  });

  it("recognises only the FTMS control point", () => {
    expect(
      isFtmsControlPoint({
        serviceUuid: FITNESS_MACHINE_SERVICE,
        characteristicUuid: FITNESS_MACHINE_CONTROL_POINT,
      }),
    ).toBe(true);
    expect(
      isFtmsControlPoint({
        serviceUuid: FITNESS_MACHINE_SERVICE,
        characteristicUuid: FITNESS_MACHINE_STATUS,
      }),
    ).toBe(false);
  });
});

describe("FtmsLabControl happy path", () => {
  it("acquires with 00 → 07 → 11 and then allows Sim 5 %", async () => {
    const r = labRig();
    await r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    expect(r.control.view()).toEqual({ kind: "granted" });
    await r.control.run(FTMS_SIM_FIVE_PRESET);
    await r.control.run(FTMS_SIM_FIVE_PRESET);
    expect(r.writes).toEqual([
      "00",
      "07",
      "11 00 00 00 00 28 33",
      "11 00 00 f4 01 28 33",
      "11 00 00 f4 01 28 33",
    ]);
    expect(r.control.view()).toEqual({ kind: "granted" });
  });
});

describe("FtmsLabControl with a Zwift Hub", () => {
  it("grants control when Start answers failed on an already started machine (80 07 04)", async () => {
    const r = labRig();
    r.ack(false);
    const running = r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    await settle();
    r.notify([0x80, 0x00, 0x01]);
    await settle();
    r.notify([0x80, 0x07, 0x04]);
    await settle();
    r.notify([0x80, 0x11, 0x01]);
    await running;
    expect(r.control.view()).toEqual({ kind: "granted" });
    expect(r.writes).toEqual(["00", "07", "11 00 00 00 00 28 33"]);
  });
});

describe("FtmsLabControl refusals", () => {
  it("refuses Sim 5 % before Request Control without writing", async () => {
    const r = labRig();
    await expect(r.control.run(FTMS_SIM_FIVE_PRESET)).rejects.toThrow("Zuerst FTMS");
    expect(r.writes).toEqual([]);
  });

  it("refuses a second preset while one is pending", async () => {
    const r = labRig();
    r.ack(false);
    const first = r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    await settle();
    await expect(r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET)).rejects.toThrow(
      "läuft bereits",
    );
    await r.advance(3);
    await expect(first).rejects.toThrow("Neu verbinden");
    expect(r.writes).toEqual(["00"]);
  });

  it("refuses trainers without control point write + indicate", async () => {
    const r = labRig({ services: [] });
    await expect(r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET)).rejects.toThrow(
      "Write und Indicate",
    );
    expect(r.writes).toEqual([]);
  });
});

describe("FtmsLabControl after a missing ACK", () => {
  it("blocks every further control-point write until a new session", async () => {
    const r = labRig();
    await r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    r.ack(false);
    const pending = r.control.run(FTMS_SIM_FIVE_PRESET);
    await settle();
    await r.advance(3);
    await expect(pending).rejects.toThrow("Neu verbinden");
    expect(r.control.view().kind).toBe("unusable");
    r.ack(true);
    await expect(r.control.run(FTMS_SIM_FIVE_PRESET)).rejects.toThrow("gesperrt");
    await expect(r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET)).rejects.toThrow(
      "gesperrt",
    );
    expect(r.writes).toEqual(["00", "07", "11 00 00 00 00 28 33", "11 00 00 f4 01 28 33"]);
  });

  it("a late 80 11 01 cannot satisfy a new wait", async () => {
    const r = labRig();
    await r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    r.ack(false);
    const pending = r.control.run(FTMS_SIM_FIVE_PRESET);
    await settle();
    await r.advance(3);
    await expect(pending).rejects.toThrow("Neu verbinden");
    r.notify([0x80, 0x11, 0x01]);
    await expect(r.control.run(FTMS_SIM_FIVE_PRESET)).rejects.toThrow("gesperrt");
    expect(r.control.view().kind).toBe("unusable");
    expect(r.writes.filter((hex) => hex === "11 00 00 f4 01 28 33")).toHaveLength(1);
  });

  it("an ACK arriving after the deadline fails instead of succeeding", async () => {
    const r = labRig();
    r.ack(false);
    const pending = r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    await settle();
    await r.advance(3.1);
    r.notify([0x80, 0x00, 0x01]);
    await expect(pending).rejects.toThrow("Neu verbinden");
    expect(r.writes).toEqual(["00"]);
  });
});

describe("FtmsLabControl exact opcode matching", () => {
  it("ignores an ACK for another opcode and keeps waiting", async () => {
    const r = labRig();
    r.ack(false);
    const pending = r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    await settle();
    r.notify([0x80, 0x11, 0x01]);
    await settle();
    expect(r.writes).toEqual(["00"]);
    r.notify([0x80, 0x00, 0x01]);
    await settle();
    r.notify([0x80, 0x07, 0x01]);
    await settle();
    r.notify([0x80, 0x11, 0x01]);
    await pending;
    expect(r.control.view()).toEqual({ kind: "granted" });
  });

  it("blocks the session on a non-success result or lost ownership", async () => {
    const rejected = labRig();
    rejected.ack(false);
    const refused = rejected.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    await settle();
    rejected.notify([0x80, 0x00, 0x05]);
    await expect(refused).rejects.toThrow("Steuerrechte");

    const lost = labRig();
    await lost.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET);
    lost.status(0xff);
    await expect(lost.control.run(FTMS_SIM_FIVE_PRESET)).rejects.toThrow("verloren");
    expect(lost.writes).toHaveLength(3);
  });

  it("invalidate blocks control and is idempotent", async () => {
    const r = labRig();
    r.control.invalidate("Rohwrite");
    r.control.invalidate("später");
    expect(r.control.view()).toEqual({ kind: "unusable", reason: "Rohwrite" });
    await expect(r.control.run(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET)).rejects.toThrow(
      "Rohwrite",
    );
    expect(r.writes).toEqual([]);
  });
});
