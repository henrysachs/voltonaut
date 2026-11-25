/**
 * Ride device set: the production adapters over one transport per device.
 * Sim and real devices differ only in the transports; the composition root
 * picks which factory supplies them.
 */

import type { EventBus } from "@voltonaut/shared";

import { createTrainerAdapter, type TrainerAdapter } from "./ftms/adapter.js";
import { createHeartRateAdapter, type HeartRateAdapter } from "./hrs/adapter.js";
import type { SimClock, TickSource } from "./sim/index.js";
import type { BleTransport } from "./transport.js";
import { createWebBluetoothTransport } from "./webBluetoothTransport.js";
import type { WebBluetoothCentral } from "./webBluetoothTypes.js";
import { createPlayAdapter, type PlayAdapter } from "./zwift-play/adapter.js";
import type { PlaySide } from "./zwift-play/parse.js";

export interface PlayTransport {
  readonly side: PlaySide;
  readonly transport: BleTransport;
}

export interface DeviceTransports {
  readonly trainer: BleTransport;
  readonly heartRate: BleTransport;
  /** One transport per Play side; empty when the source offers no Play controllers. */
  readonly play: readonly PlayTransport[];
}

export interface RideDeviceSet {
  readonly trainer: TrainerAdapter;
  readonly heartRate: HeartRateAdapter;
  readonly play: readonly PlayAdapter[];
}

export interface RideDeviceSetOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  /** Ride clock scale, fixed for the set's lifetime; trainer control requires exactly 1. */
  readonly clockScale: number;
  readonly transports: DeviceTransports;
}

export function createRideDeviceSet(options: RideDeviceSetOptions): RideDeviceSet {
  const { bus, clock, ticker, clockScale, transports } = options;

  return {
    trainer: createTrainerAdapter({
      bus,
      clock,
      ticker,
      clockScale,
      transport: transports.trainer,
    }),
    heartRate: createHeartRateAdapter({ bus, clock, ticker, transport: transports.heartRate }),
    play: transports.play.map(({ side, transport }) =>
      createPlayAdapter({ bus, clock, ticker, side, transport }),
    ),
  };
}

export function createBluetoothDeviceTransports(central: WebBluetoothCentral): DeviceTransports {
  return {
    trainer: createWebBluetoothTransport({ central }),
    heartRate: createWebBluetoothTransport({ central }),
    play: (["left", "right"] satisfies readonly PlaySide[]).map((side) => ({
      side,
      transport: createWebBluetoothTransport({ central }),
    })),
  };
}
