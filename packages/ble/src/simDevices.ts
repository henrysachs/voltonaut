/**
 * Sim device source: scripted GATT peripherals behind the sim transport. The
 * production adapters connect to them exactly as to real devices.
 *
 * No Play peripheral: the former FakePlay adapter was never wired into the
 * dialog and its press methods had no app caller. Sim shifting stays on the
 * keyboard adapter (↑/↓); native Play paths are covered by GATT-fake E2E tests.
 */

import type { DeviceTransports } from "./devices.js";
import { createSimTrainerPeripheral } from "./ftms/simTrainer.js";
import { createSimStrapPeripheral } from "./hrs/simStrap.js";
import type { SimScript, TickSource } from "./sim/index.js";
import { createSimTransport } from "./sim/transport.js";

export interface SimDeviceTransportOptions {
  /** Paces the scripted notifications of every sim peripheral. */
  readonly ticker: TickSource;
  readonly samples: SimScript;
}

export function createSimDeviceTransports(options: SimDeviceTransportOptions): DeviceTransports {
  return {
    trainer: createSimTransport(createSimTrainerPeripheral(options)),
    heartRate: createSimTransport(createSimStrapPeripheral(options)),
    play: [],
  };
}
